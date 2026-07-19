import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { HubConnectionBuilder } from "@microsoft/signalr";

type Role = "Batsman" | "Bowler" | "All-rounder" | "Wicket-keeper";
type View = "dashboard" | "profile" | "player-logs";
type DashboardSection = "squad" | "schedules" | "results";

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

type PlayerLog = {
  id: number;
  jerseyNo: number;
  name: string;
  email: string;
  password: string;
};

type CreatePlayerForm = {
  name: string;
  email: string;
  jerseyNo: string;
  password: string;
};

const SESSION_WARNING_MS = 60_000;
const SESSION_TIMEOUT_MS = 120_000;

const roles: Array<{ label: Role; plural: string; icon: string }> = [
  { label: "Batsman", plural: "Batsmen", icon: "◒" },
  { label: "Bowler", plural: "Bowlers", icon: "↘" },
  { label: "All-rounder", plural: "All-rounders", icon: "✦" },
  { label: "Wicket-keeper", plural: "Wicket-keepers", icon: "⌑" },
];

async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    cache: "no-store",
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

function readSessionValue<T>(key: string, fallback: T): T {
  try {
    const stored = window.sessionStorage.getItem(key);
    return stored ? JSON.parse(stored) as T : fallback;
  } catch {
    return fallback;
  }
}

function writeSessionValue(key: string, value: unknown) {
  try {
    window.sessionStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Session persistence is a convenience; the app remains usable if storage is unavailable.
  }
}

function clearSessionValue(key: string) {
  try {
    window.sessionStorage.removeItem(key);
  } catch {
    // Ignore unavailable session storage during sign out.
  }
}

const refreshStateKeys = [
  "fightclub-session",
  "fightclub-view",
  "fightclub-section",
  "fightclub-role",
  "fightclub-sidebar-collapsed",
  "fightclub-match",
];

function App() {
  const [session, setSession] = useState<Session | null>(() => readSessionValue<Session | null>("fightclub-session", null));
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [loginError, setLoginError] = useState("");
  const [loading, setLoading] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => readSessionValue("fightclub-sidebar-collapsed", false));
  const [view, setView] = useState<View>(() => readSessionValue<View>("fightclub-view", "dashboard"));
  const [activeSection, setActiveSection] = useState<DashboardSection>(() => readSessionValue<DashboardSection>("fightclub-section", "squad"));
  const [activeRole, setActiveRole] = useState<Role | "All">(() => readSessionValue<Role | "All">("fightclub-role", "All"));
  const [players, setPlayers] = useState<Player[]>([]);
  const [matches, setMatches] = useState<Match[]>([]);
  const [playerLogs, setPlayerLogs] = useState<PlayerLog[]>([]);
  const [playerLogsEditing, setPlayerLogsEditing] = useState(false);
  const [playerLogDrafts, setPlayerLogDrafts] = useState<Record<number, string>>({});
  const [visiblePlayerPasswords, setVisiblePlayerPasswords] = useState<Record<number, boolean>>({});
  const [playerLogsMessage, setPlayerLogsMessage] = useState("");
  const [createPlayerOpen, setCreatePlayerOpen] = useState(false);
  const [createPlayerForm, setCreatePlayerForm] = useState<CreatePlayerForm>({ name: "", email: "", jerseyNo: "", password: "" });
  const [createPlayerMessage, setCreatePlayerMessage] = useState("");
  const [selectedMatchId, setSelectedMatchId] = useState(() => readSessionValue("fightclub-match", 1));
  const [selectedPlayer, setSelectedPlayer] = useState<Player | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [profileEditing, setProfileEditing] = useState(false);
  const [profileDraft, setProfileDraft] = useState({ phone: "", timezone: "" });
  const [profileMessage, setProfileMessage] = useState("");
  const [passwordModalOpen, setPasswordModalOpen] = useState(false);
  const [passwordForm, setPasswordForm] = useState({ currentPassword: "", newPassword: "", confirmPassword: "" });
  const [passwordMessage, setPasswordMessage] = useState("");
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const [darkMode, setDarkMode] = useState(() => window.localStorage.getItem("fightclub-theme") === "dark");
  const [liveMessage, setLiveMessage] = useState("Ready for match day.");
  const [sessionWarningSeconds, setSessionWarningSeconds] = useState<number | null>(null);
  const lastActivityAt = useRef(Date.now());

  useEffect(() => {
    window.localStorage.setItem("fightclub-theme", darkMode ? "dark" : "light");
  }, [darkMode]);

  useEffect(() => {
    if (!session) {
      refreshStateKeys.forEach(clearSessionValue);
      return;
    }
    writeSessionValue("fightclub-session", session);
    writeSessionValue("fightclub-view", view);
    writeSessionValue("fightclub-section", activeSection);
    writeSessionValue("fightclub-role", activeRole);
    writeSessionValue("fightclub-sidebar-collapsed", sidebarCollapsed);
    writeSessionValue("fightclub-match", selectedMatchId);
  }, [session, view, activeSection, activeRole, sidebarCollapsed, selectedMatchId]);

  useEffect(() => {
    if (!session) {
      setSessionWarningSeconds(null);
      return;
    }

    lastActivityAt.current = Date.now();
    const markActivity = () => {
      const now = Date.now();
      if (now - lastActivityAt.current < SESSION_WARNING_MS) {
        lastActivityAt.current = now;
      }
    };
    const activityEvents: Array<keyof WindowEventMap> = ["mousemove", "mousedown", "keydown", "touchstart", "scroll", "pointerdown"];
    activityEvents.forEach((eventName) => window.addEventListener(eventName, markActivity, { passive: true }));

    const timeoutTimer = window.setInterval(() => {
      const idleTime = Date.now() - lastActivityAt.current;
      if (idleTime >= SESSION_TIMEOUT_MS) {
        signOut();
        return;
      }
      setSessionWarningSeconds(idleTime >= SESSION_WARNING_MS
        ? Math.ceil((SESSION_TIMEOUT_MS - idleTime) / 1000)
        : null);
    }, 1000);

    return () => {
      window.clearInterval(timeoutTimer);
      activityEvents.forEach((eventName) => window.removeEventListener(eventName, markActivity));
    };
  }, [session]);

  const selectedMatch = matches.find((match) => match.id === selectedMatchId) ?? matches[0];
  const visiblePlayers = useMemo(
    () => activeRole === "All" ? players : players.filter((player) => player.roles.includes(activeRole)),
    [activeRole, players],
  );

  useEffect(() => {
    if (!session) return;
    let cancelled = false;

    const refreshData = async () => {
      try {
        const [roster, previousMatches] = await Promise.all([
          api<Player[]>("/api/players"),
          api<Match[]>("/api/matches/previous"),
        ]);
        if (cancelled) return;
        setPlayers(roster);
        setMatches(previousMatches);
        setSelectedMatchId((current) => previousMatches.some((match) => match.id === current)
          ? current
          : (previousMatches[0]?.id ?? 1));
      } catch (error) {
        if (!cancelled) setLiveMessage(error instanceof Error ? error.message : "Unable to refresh live data.");
      }
    };

    void refreshData();
    const refreshTimer = window.setInterval(() => { void refreshData(); }, 3000);

    const connection = new HubConnectionBuilder().withUrl("/hubs/stats").withAutomaticReconnect().build();
    connection.on("playerUpdated", (updated: Player) => {
      setPlayers((current) => current.map((player) => player.id === updated.id ? updated : player));
      setSelectedPlayer((current) => current?.id === updated.id ? updated : current);
      setLiveMessage(`${updated.name}'s live stats were updated.`);
    });
    connection.start().catch(() => setLiveMessage("Live updates will resume when the API is available."));
    return () => {
      cancelled = true;
      window.clearInterval(refreshTimer);
      void connection.stop();
    };
  }, [session]);

  useEffect(() => {
    if (!session || view !== "profile") return;
    let cancelled = false;
    api<Profile>("/api/profile")
      .then((loadedProfile) => {
        if (cancelled) return;
        setProfile(loadedProfile);
        setProfileDraft({ phone: loadedProfile.phone, timezone: loadedProfile.timezone });
      })
      .catch((error) => {
        if (!cancelled) setProfileMessage(error instanceof Error ? error.message : "Unable to load profile.");
      });
    return () => { cancelled = true; };
  }, [session, view]);

  useEffect(() => {
    if (!session || view !== "player-logs") return;
    let cancelled = false;
    api<PlayerLog[]>("/api/player-logs")
      .then((logs) => {
        if (cancelled) return;
        setPlayerLogs(logs);
        setPlayerLogDrafts(Object.fromEntries(logs.map((log) => [log.id, log.password])));
        setVisiblePlayerPasswords({});
        setPlayerLogsMessage("");
      })
      .catch((error) => {
        if (!cancelled) setPlayerLogsMessage(error instanceof Error ? error.message : "Unable to load player logs.");
      });
    return () => { cancelled = true; };
  }, [session, view]);

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
    setSessionWarningSeconds(null);
    setView("dashboard");
    setPlayers([]);
    setMatches([]);
    setPlayerLogs([]);
    setPlayerLogsEditing(false);
    setPlayerLogDrafts({});
    setVisiblePlayerPasswords({});
    setPlayerLogsMessage("");
    setCreatePlayerOpen(false);
    setCreatePlayerForm({ name: "", email: "", jerseyNo: "", password: "" });
    setCreatePlayerMessage("");
    setProfile(null);
    setProfileMenuOpen(false);
    setLiveMessage("Signed out of Fightclub IX.");
  }

  function renewSession() {
    lastActivityAt.current = Date.now();
    setSessionWarningSeconds(null);
    setLiveMessage("Session renewed for Fightclub IX.");
  }

  function openProfile() {
    setProfileMenuOpen(false);
    setView("profile");
    setProfile(null);
    setProfileMessage("");
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

  function togglePlayerPassword(id: number) {
    setVisiblePlayerPasswords((current) => ({ ...current, [id]: !current[id] }));
  }

  async function savePlayerLogs() {
    try {
      const updatedLogs = await Promise.all(playerLogs.map((log) => api<PlayerLog>(`/api/player-logs/${log.id}`, {
        method: "PUT",
        body: JSON.stringify({ password: playerLogDrafts[log.id] ?? log.password }),
      })));
      setPlayerLogs(updatedLogs);
      setPlayerLogDrafts(Object.fromEntries(updatedLogs.map((log) => [log.id, log.password])));
      setPlayerLogsEditing(false);
      setVisiblePlayerPasswords({});
      setPlayerLogsMessage("Player passwords saved for this local demo.");
    } catch (error) {
      setPlayerLogsMessage(error instanceof Error ? error.message : "Unable to save player passwords.");
    }
  }

  async function createPlayerProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setCreatePlayerMessage("");
    try {
      const created = await api<PlayerLog>("/api/player-logs", {
        method: "POST",
        body: JSON.stringify({
          name: createPlayerForm.name,
          email: createPlayerForm.email,
          jerseyNo: Number(createPlayerForm.jerseyNo),
          password: createPlayerForm.password,
        }),
      });
      setPlayerLogs((current) => [...current, created]);
      setPlayerLogDrafts((current) => ({ ...current, [created.id]: created.password }));
      setCreatePlayerOpen(false);
      setCreatePlayerForm({ name: "", email: "", jerseyNo: "", password: "" });
      setPlayerLogsMessage(`${created.name} was added to the player logs.`);
    } catch (error) {
      setCreatePlayerMessage(error instanceof Error ? error.message : "Unable to create player profile.");
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
            <div className="team-lockup"><span className="team-emblem" aria-hidden="true"><span className="emblem-spark">✦</span><small>FIGHT</small><strong>IX</strong></span><span><strong>FIGHTCLUB</strong><small>IX · ESTD. 2023</small></span></div>
            <h1>Lead the team.<br /><em>Own every over.</em></h1>
            <p>Bring every player, role, and match moment together in one focused team room.</p>
          </div>
          <div className="login-visual-footer">
            <span><strong>16</strong> players</span><span><strong>1</strong> family</span>
          </div>
        </section>
        <section className="login-panel">
          <div className="login-card">
            <div className="login-card-top"><span className="mini-team-logo" aria-label="Fightclub IX logo"><span>FC</span><strong>FIGHTCLUB <b>IX</b></strong></span><span className="secure-pill"><StatusDot /> Secure team room</span></div>
            <div className="login-card-heading"><span><h2>Welcome Champ</h2></span></div>
            <p className="login-copy">Sign in to View your stats, review match day performance, and capture your innings.</p>
            <form onSubmit={handleLogin} className="login-form" autoComplete="off">
              <label htmlFor="email">Email</label>
              <div className="input-wrap"><span aria-hidden="true"></span><input id="email" name="login-email" type="email" autoComplete="off" data-lpignore="true" placeholder="Enter your email" value={email} onChange={(event) => setEmail(event.target.value)} required /></div>
              <div className="field-label-row"><label htmlFor="password">Password</label><button type="button" className="text-link" onClick={() => setPasswordVisible((current) => !current)}>{passwordVisible ? "Hide" : "Show"}</button></div>
              <div className="input-wrap"><span aria-hidden="true">⌁</span><input id="password" name="login-password" type={passwordVisible ? "text" : "password"} autoComplete="new-password" data-lpignore="true" placeholder="Enter your password" value={password} onChange={(event) => setPassword(event.target.value)} required /></div>
              {loginError && <p className="form-message error" role="alert">{loginError}</p>}
              <button className="primary-button login-submit" type="submit" disabled={loading}>{loading ? "Opening team room…" : "Enter Fightclub IX Dashboard"}<span>→</span></button>
            </form>
            <div className="login-card-footer"><span className="footer-line" /><p>Fightclub IX - Reserved @2023</p><span className="footer-line" /></div>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className={`app-shell ${darkMode ? "theme-dark" : ""} ${sidebarCollapsed ? "nav-collapsed" : ""}`}>
      <aside className={`sidebar ${sidebarCollapsed ? "is-collapsed" : ""}`}>
        <div className="admin-identity"><span className="avatar avatar-admin">A</span><span><strong>{session.name}</strong><small>{session.email}</small><b>ADMIN · FIGHTCLUB IX</b></span><button className="hamburger" type="button" onClick={() => setSidebarCollapsed((current) => !current)} aria-expanded={!sidebarCollapsed} aria-label={sidebarCollapsed ? "Open navigation" : "Collapse navigation"}><span>☰</span><b>{sidebarCollapsed ? "Open" : "Collapse"}</b></button></div>
        <div className="team-health"><span><StatusDot /> ADMIN SESSION</span><strong>{players.length || 16} players</strong><small>Live squad performance</small></div>
        <nav className="side-nav" aria-label="Team navigation">
          <button aria-label="Squad" title="Squad" className={view === "dashboard" && activeSection === "squad" ? "active" : ""} type="button" onClick={() => { setView("dashboard"); setActiveSection("squad"); }}><span>⌂</span><b>Squad</b></button>
          <button aria-label="Match schedules" title="Match schedules" className={view === "dashboard" && activeSection === "schedules" ? "active" : ""} type="button" onClick={() => { setView("dashboard"); setActiveSection("schedules"); }}><span>◷</span><b>Match schedules</b></button>
          <button aria-label="Match results" title="Match results" className={view === "dashboard" && activeSection === "results" ? "active" : ""} type="button" onClick={() => { setView("dashboard"); setActiveSection("results"); }}><span>↗</span><b>Match results</b></button>
          <button aria-label="Players logs" title="Players logs" className={view === "player-logs" ? "active" : ""} type="button" onClick={() => setView("player-logs")}><span>▤</span><b>Players logs</b></button>
        </nav>
        <button className="sidebar-signout" type="button" onClick={signOut}><span>↪</span><b>Sign out</b></button>
      </aside>

      <section className="main-panel">
        <header className="app-header"><div><span className="kicker">{view === "profile" ? "Account settings" : "Fightclub IX · Administrator workspace"}</span><h1>{view === "profile" ? "Admin profile" : `Welcome back, ${session.name}`}</h1></div><div className="header-actions"><span className="live-indicator"><StatusDot /> Live sync</span><div className="profile-menu-wrap"><button className="header-avatar" type="button" onClick={() => setProfileMenuOpen((current) => !current)} aria-expanded={profileMenuOpen} aria-haspopup="menu">{session.name.slice(0, 2).toUpperCase()}</button>{profileMenuOpen && <div className="profile-menu" role="menu"><button type="button" role="menuitem" onClick={openProfile}>View profile</button><button type="button" role="menuitem" className="theme-toggle" onClick={() => setDarkMode((current) => !current)}><span>{darkMode ? "Light mode" : "Dark mode"}</span><span className={`toggle-track ${darkMode ? "is-on" : ""}`} aria-hidden="true"><span /></span></button><button type="button" role="menuitem" onClick={signOut}>Sign out</button></div>}</div></div></header>

        {view === "profile" ? (
          <ProfilePage profile={profile} editing={profileEditing} draft={profileDraft} message={profileMessage} onBack={() => setView("dashboard")} onEdit={() => { if (profile) setProfileDraft({ phone: profile.phone, timezone: profile.timezone }); setProfileEditing(true); }} onCancel={() => setProfileEditing(false)} onSave={saveProfile} onDraftChange={setProfileDraft} onPassword={() => { setPasswordMessage(""); setPasswordModalOpen(true); }} />
        ) : view === "player-logs" ? (
          <PlayerLogsPage logs={playerLogs} drafts={playerLogDrafts} editing={playerLogsEditing} visiblePasswords={visiblePlayerPasswords} message={playerLogsMessage} onCreate={() => { setCreatePlayerMessage(""); setCreatePlayerOpen(true); }} onEdit={() => { setPlayerLogsEditing(true); setPlayerLogsMessage(""); }} onCancel={() => { setPlayerLogsEditing(false); setPlayerLogDrafts(Object.fromEntries(playerLogs.map((log) => [log.id, log.password]))); setVisiblePlayerPasswords({}); }} onSave={savePlayerLogs} onDraftChange={(id, password) => setPlayerLogDrafts((current) => ({ ...current, [id]: password }))} onTogglePassword={togglePlayerPassword} />
        ) : (
          activeSection === "squad" ? (
          <div className="dashboard-content">
            <section className="match-overview-card">
              <div className="section-label"><span>Previous match overview</span><select value={selectedMatch?.id ?? ""} onChange={(event) => setSelectedMatchId(Number(event.target.value))}>{matches.map((match) => <option key={match.id} value={match.id}>{match.opponent} · {formatDate(match.playedOn)}</option>)}</select></div>
              {selectedMatch ? <div className="match-scoreboard"><div className="team-circle team-ours" data-tooltip={`Fightclub IX · ${selectedMatch.ourScore} runs`} title={`Fightclub IX · ${selectedMatch.ourScore} runs`}><span>OUR TEAM</span><strong>Fightclub IX</strong><b>{selectedMatch.ourScore}</b></div><div className="match-result"><small>{selectedMatch.result}</small><span>VS</span></div><div className="team-circle team-opponent" data-tooltip={`${selectedMatch.opponent} · ${selectedMatch.opponentScore} runs`} title={`${selectedMatch.opponent} · ${selectedMatch.opponentScore} runs`}><span>OPPONENT</span><strong>{selectedMatch.opponent}</strong><b>{selectedMatch.opponentScore}</b></div></div> : <p className="loading-copy">Loading match history…</p>}
            </section>
            <section className="roster-section"><div className="section-heading"><div><span className="kicker">{activeRole === "All" ? "Full squad" : activeRole + " group"}</span><h2>{activeRole === "All" ? `Your ${players.length || 16} players` : roles.find((role) => role.label === activeRole)?.plural}</h2></div><span className="roster-count">{visiblePlayers.length} players</span></div><div className="role-filter" aria-label="Filter squad roles"><button className={activeRole === "All" ? "active" : ""} type="button" onClick={() => setActiveRole("All")}>All</button>{roles.map((role) => <button className={activeRole === role.label ? "active" : ""} type="button" key={role.label} onClick={() => setActiveRole(role.label)}>{role.plural}</button>)}</div><p className="section-copy">Select a player to view the stats and duties assigned to their role.</p><div className="player-grid">{visiblePlayers.map((player) => { const isAvailable = player.availability.toLowerCase() === "available"; return <button className="player-card" type="button" key={player.id} onClick={() => setSelectedPlayer(player)}><span className={`avatar role-${player.roles[0].toLowerCase().replace("-", "")}`}>{player.initials}</span><span className="player-card-copy"><strong>{player.name}</strong><small>{player.roles.join(" · ")}</small></span><span className={`availability ${isAvailable ? "available" : "unavailable"}`} role="img" aria-label={`${player.name} is ${isAvailable ? "available" : "not available"} for the match`} title={`${isAvailable ? "Available" : "Not available"} for the match`} /><span className="player-card-stats"><b>{player.runs}<small>Runs</small></b><b>{player.wickets}<small>Wkts</small></b><b>{player.catches}<small>Catches</small></b></span></button>; })}</div></section>
            <p className="sr-only" aria-live="polite">{liveMessage}</p>
          </div>
          ) : <MatchList matches={matches} mode={activeSection} />
        )}
      </section>

      {selectedPlayer && <PlayerModal player={selectedPlayer} onClose={() => setSelectedPlayer(null)} onChangeStat={changeStat} />}
      {passwordModalOpen && <PasswordModal form={passwordForm} message={passwordMessage} onClose={() => setPasswordModalOpen(false)} onSubmit={submitPassword} onChange={setPasswordForm} />}
      {createPlayerOpen && <CreatePlayerProfileModal form={createPlayerForm} message={createPlayerMessage} onClose={() => { setCreatePlayerOpen(false); setCreatePlayerMessage(""); }} onSubmit={createPlayerProfile} onChange={setCreatePlayerForm} />}
      {sessionWarningSeconds !== null && <SessionTimeoutModal remainingSeconds={sessionWarningSeconds} onRenew={renewSession} onSignOut={signOut} />}
    </main>
  );
}

function ProfilePage({ profile, editing, draft, message, onBack, onEdit, onCancel, onSave, onDraftChange, onPassword }: { profile: Profile | null; editing: boolean; draft: { phone: string; timezone: string }; message: string; onBack: () => void; onEdit: () => void; onCancel: () => void; onSave: () => void; onDraftChange: (draft: { phone: string; timezone: string }) => void; onPassword: () => void }) {
  if (!profile) return <div className="empty-state"><p>Loading admin profile…</p><button className="text-button" type="button" onClick={onBack}>← Back to dashboard</button></div>;
  return <section className="profile-page"><button className="text-button" type="button" onClick={onBack}>← Back to dashboard</button><div className="profile-heading"><div><span className="kicker">Admin account</span><h2>Profile Settings</h2><p>Manage the account that keeps Fightclub IX match data moving.</p></div><span className="verified-badge"><StatusDot /> Identity verified</span></div><article className="profile-card"><div className="profile-hero"><span className="avatar avatar-admin avatar-large">AD</span><div><span className="kicker">Team administrator</span><h3>{profile.name}</h3><p>{profile.email}</p></div></div><dl className="profile-details"><div><dt>Full name</dt><dd>{profile.name}</dd></div><div><dt>Email address</dt><dd>{profile.email}</dd></div><div><dt>Phone number</dt><dd>{editing ? <input value={draft.phone} type="tel" onChange={(event) => onDraftChange({ ...draft, phone: event.target.value })} /> : profile.phone}</dd></div><div><dt>Time zone</dt><dd>{editing ? <input value={draft.timezone} onChange={(event) => onDraftChange({ ...draft, timezone: event.target.value })} /> : profile.timezone}</dd></div></dl><div className="profile-actions">{editing ? <><button className="primary-button compact" type="button" onClick={onSave}>Save changes</button><button className="secondary-button" type="button" onClick={onCancel}>Cancel</button><button className="secondary-button" type="button" onClick={onPassword}>Change password</button></> : <button className="primary-button compact" type="button" onClick={onEdit}>Edit profile</button>}{message && <p className="form-message success" role="status">{message}</p>}</div></article></section>;
}

function MatchList({ matches, mode }: { matches: Match[]; mode: "schedules" | "results" }) {
  const isSchedule = mode === "schedules";
  return <div className="dashboard-content"><section className="content-card match-list-panel"><div className="section-heading"><div><span className="kicker">{isSchedule ? "Fixtures" : "Score archive"}</span><h2>{isSchedule ? "Match schedules" : "Match results"}</h2></div><span className="roster-count">{matches.length} matches</span></div><p className="section-copy">{isSchedule ? "Review the fixtures and venues for the Fightclub IX season." : "Review every previous result and final score."}</p><div className="match-list">{matches.map((match) => <article className="match-list-item" key={match.id}><div><span className="kicker">{formatDate(match.playedOn)}</span><h3>Fightclub IX <span>vs</span> {match.opponent}</h3><small>{match.venue}</small></div>{isSchedule ? <span className="match-status">Fixture</span> : <div className="match-list-score"><strong>{match.ourScore}</strong><span>–</span><strong>{match.opponentScore}</strong><small>{match.result}</small></div>}</article>)}</div></section></div>;
}

function PlayerLogsPage({ logs, drafts, editing, visiblePasswords, message, onCreate, onEdit, onCancel, onSave, onDraftChange, onTogglePassword }: { logs: PlayerLog[]; drafts: Record<number, string>; editing: boolean; visiblePasswords: Record<number, boolean>; message: string; onCreate: () => void; onEdit: () => void; onCancel: () => void; onSave: () => void; onDraftChange: (id: number, password: string) => void; onTogglePassword: (id: number) => void }) {
  return <div className="dashboard-content player-logs-page"><section className="content-card player-logs-card"><div className="section-heading"><div><span className="kicker">Administrator access</span><h2>Players logs</h2></div><div className="player-logs-heading-actions"><span className="roster-count">{logs.length} players</span><button className="primary-button compact create-player-button" type="button" onClick={onCreate}>Create player profile</button></div></div><p className="section-copy">Review player login records. Names, email addresses, and jersey numbers are read-only; only passwords can be edited.</p><div className="player-logs-table-wrap">{logs.length ? <table className="player-logs-table"><thead><tr><th scope="col">Jersey no</th><th scope="col">Name</th><th scope="col">Email</th><th scope="col">Password</th></tr></thead><tbody>{logs.map((log) => { const isVisible = Boolean(visiblePasswords[log.id]); const password = drafts[log.id] ?? log.password; return <tr key={log.id}><td>{log.jerseyNo}</td><th scope="row">{log.name}</th><td>{log.email}</td><td><div className="password-cell"><input aria-label={`${log.name} password`} type={isVisible ? "text" : "password"} value={password} readOnly={!editing} onChange={(event) => onDraftChange(log.id, event.target.value)} /><button type="button" className="password-visibility" aria-label={`${isVisible ? "Hide" : "Show"} ${log.name} password`} onClick={() => onTogglePassword(log.id)}><span aria-hidden="true">{isVisible ? "◉" : "◌"}</span></button></div></td></tr>; })}</tbody></table> : <p className="loading-copy">Loading player logs…</p>}</div><div className="player-logs-actions">{editing ? <><button className="primary-button compact" type="button" onClick={onSave}>Save passwords</button><button className="secondary-button" type="button" onClick={onCancel}>Cancel</button></> : <button className="primary-button compact" type="button" onClick={onEdit}>Edit</button>}{message && <p className="form-message success" role="status">{message}</p>}</div></section></div>;
}

function CreatePlayerProfileModal({ form, message, onClose, onSubmit, onChange }: { form: CreatePlayerForm; message: string; onClose: () => void; onSubmit: (event: FormEvent<HTMLFormElement>) => void; onChange: (form: CreatePlayerForm) => void }) {
  return <div className="modal-backdrop" role="presentation" onMouseDown={onClose}><article className="modal-card create-player-modal" role="dialog" aria-modal="true" aria-labelledby="create-player-title" onMouseDown={(event) => event.stopPropagation()}><button className="modal-close" type="button" onClick={onClose} aria-label="Close create player profile">×</button><span className="security-icon">+</span><span className="kicker">Player management</span><h2 id="create-player-title">Create player profile</h2><p>Add a player login to the Fightclub IX roster.</p><form className="password-form" onSubmit={onSubmit}><label>Enter Name<input type="text" value={form.name} onChange={(event) => onChange({ ...form, name: event.target.value })} required /></label><label>Enter Email<input type="email" value={form.email} onChange={(event) => onChange({ ...form, email: event.target.value })} required /></label><label>Jersey No<input type="number" min="1" value={form.jerseyNo} onChange={(event) => onChange({ ...form, jerseyNo: event.target.value })} required /></label><label>Password<input type="password" minLength={8} value={form.password} onChange={(event) => onChange({ ...form, password: event.target.value })} required /></label>{message && <p className="form-message error" role="alert">{message}</p>}<div className="password-actions"><button className="primary-button" type="submit">Update info</button><button className="secondary-button" type="button" onClick={onClose}>Cancel</button></div></form></article></div>;
}

function SessionTimeoutModal({ remainingSeconds, onRenew, onSignOut }: { remainingSeconds: number; onRenew: () => void; onSignOut: () => void }) {
  return <div className="modal-backdrop session-timeout-backdrop" role="presentation"><article className="modal-card session-timeout-modal" role="dialog" aria-modal="true" aria-labelledby="session-timeout-title"><span className="security-icon">!</span><span className="kicker">Security notice</span><h2 id="session-timeout-title">Your session is about to expire</h2><p>You have been inactive. For your security, you will be signed out in:</p><strong className="session-timeout-countdown" aria-live="polite">{remainingSeconds}s</strong><div className="password-actions session-timeout-actions"><button className="primary-button" type="button" onClick={onRenew}>Renew session</button><button className="secondary-button" type="button" onClick={onSignOut}>Sign out</button></div></article></div>;
}

function PlayerModal({ player, onClose, onChangeStat }: { player: Player; onClose: () => void; onChangeStat: (stat: "runs" | "wickets" | "catches") => void }) {
  const [activePlayerRole, setActivePlayerRole] = useState<Role>(player.roles[0]);
  const statName = activePlayerRole === "Batsman" ? "runs" : activePlayerRole === "Bowler" ? "wickets" : "catches";
  const statLabel = statName === "runs" ? "run" : statName === "wickets" ? "wicket" : "catch";
  const roleDescription = activePlayerRole === "Batsman" ? "Build the innings, rotate the strike, and anchor the team score." : activePlayerRole === "Bowler" ? "Set the field, control the run rate, and take wickets at key moments." : activePlayerRole === "All-rounder" ? "Contribute with both bat and ball whenever the team needs balance." : "Lead the gloves, take catches, and organise the field from behind the stumps.";
  return <div className="modal-backdrop" role="presentation" onMouseDown={onClose}><article className="modal-card player-modal" role="dialog" aria-modal="true" aria-labelledby="player-modal-title" onMouseDown={(event) => event.stopPropagation()}><button className="modal-close" type="button" onClick={onClose} aria-label="Close player details">×</button><div className="modal-player-heading"><span className={`avatar avatar-large role-${activePlayerRole.toLowerCase().replace("-", "")}`}>{player.initials}</span><div><span className="kicker">Player profile</span><h2 id="player-modal-title">{player.name}</h2><p>{player.email}</p></div></div><div className="role-tabs" role="tablist" aria-label={`${player.name} roles`}>{player.roles.map((role) => <button className={activePlayerRole === role ? "active" : ""} type="button" role="tab" aria-selected={activePlayerRole === role} key={role} onClick={() => setActivePlayerRole(role)}>{role}</button>)}</div><div className="role-description"><strong>{activePlayerRole} duties</strong><p>{roleDescription}</p></div><div className="modal-stats"><span><b>{player.runs}</b><small>Runs</small></span><span><b>{player.wickets}</b><small>Wickets</small></span><span><b>{player.catches}</b><small>Catches</small></span></div><div className="modal-footer"><span>Joined {formatDate(player.joinedOn)}</span><button className="primary-button compact" type="button" onClick={() => onChangeStat(statName)}>Record {statLabel}</button></div></article></div>;
}

function PasswordModal({ form, message, onClose, onSubmit, onChange }: { form: { currentPassword: string; newPassword: string; confirmPassword: string }; message: string; onClose: () => void; onSubmit: (event: FormEvent<HTMLFormElement>) => void; onChange: (form: { currentPassword: string; newPassword: string; confirmPassword: string }) => void }) {
  return <div className="modal-backdrop" role="presentation" onMouseDown={onClose}><article className="modal-card password-modal" role="dialog" aria-modal="true" aria-labelledby="password-title" onMouseDown={(event) => event.stopPropagation()}><button className="modal-close" type="button" onClick={onClose} aria-label="Close change password">×</button><span className="security-icon">•••</span><span className="kicker">Account security</span><h2 id="password-title">Change password</h2><p>Update the password used by the Fightclub IX administrator account.</p><form className="password-form" onSubmit={onSubmit}><label>Current password<input type="password" value={form.currentPassword} onChange={(event) => onChange({ ...form, currentPassword: event.target.value })} required /></label><label>New password<input type="password" value={form.newPassword} onChange={(event) => onChange({ ...form, newPassword: event.target.value })} required /></label><label>Confirm new password<input type="password" value={form.confirmPassword} onChange={(event) => onChange({ ...form, confirmPassword: event.target.value })} required /></label>{message && <p className="form-message" role="status">{message}</p>}<div className="password-actions"><button className="primary-button" type="submit">Update password</button><button className="secondary-button" type="button" onClick={onClose}>Cancel</button></div></form></article></div>;
}

export default App;
