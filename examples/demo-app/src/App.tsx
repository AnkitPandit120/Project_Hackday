import { useEffect, useState, type FormEvent } from "react";
import { Link, Navigate, NavLink, Outlet, Route, Routes, useNavigate } from "react-router-dom";

type Session = { username: string } | null;

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/admin" element={<AdminLayout />}>
        <Route index element={<Dashboard />} />
        <Route path="users" element={<Users />} />
        <Route path="settings" element={<Settings />} />
        <Route path="activity" element={<Activity />} />
      </Route>
      <Route path="*" element={<Navigate to="/login" replace />} />
    </Routes>
  );
}

function Login() {
  const navigate = useNavigate();
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const response = await fetch("/api/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: form.get("username"), password: form.get("password") }),
    });
    if (!response.ok) {
      setError("Those credentials were not accepted.");
      return;
    }
    navigate("/admin");
  }

  return (
    <form className="login" onSubmit={(event) => void submit(event)}>
      <h1>Acme Admin</h1>
      <label>
        Username
        <input name="username" autoComplete="username" defaultValue="demo" />
      </label>
      <label>
        Password
        <input name="password" type="password" autoComplete="current-password" defaultValue="demo" />
      </label>
      <button type="submit">Sign in</button>
      {error ? <p>{error}</p> : null}
    </form>
  );
}

function AdminLayout() {
  const [session, setSession] = useState<Session | undefined>(undefined);

  useEffect(() => {
    void fetch("/api/me")
      .then(async (response) => {
        if (!response.ok) {
          setSession(null);
          return;
        }
        const body = (await response.json()) as { user: { username: string } };
        setSession(body.user);
      })
      .catch(() => setSession(null));
  }, []);

  if (session === undefined) return <p>Loading the session.</p>;
  if (session === null) return <Navigate to="/login" replace />;

  return (
    <main>
      <nav aria-label="Primary">
        <NavLink to="/admin" end>Dashboard</NavLink>
        <NavLink to="/admin/users">Users</NavLink>
        <NavLink to="/admin/settings">Settings</NavLink>
        <Link to="/admin/activity">Activity</Link>
        <a href="/logout">Log out</a>
      </nav>
      <Outlet />
    </main>
  );
}

function Dashboard() {
  return (
    <section>
      <h1>Dashboard</h1>
      <h2>This week</h2>
      <p>Twelve workspaces are active. Review the queue before Friday.</p>
    </section>
  );
}

function Users() {
  return (
    <section>
      <h1>Users</h1>
      <table>
        <thead>
          <tr>
            <th>Name</th>
            <th>Role</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Ada Lovelace</td>
            <td>Owner</td>
          </tr>
          <tr>
            <td>Grace Hopper</td>
            <td>Admin</td>
          </tr>
        </tbody>
      </table>
    </section>
  );
}

function Settings() {
  return (
    <section>
      <h1>Settings</h1>
      <form method="post" action="/api/admin/settings">
        <label htmlFor="email">Work email</label>
        <input id="email" name="email" type="email" autoComplete="email" placeholder="ada@acme.test" required />
        <label htmlFor="password">Password</label>
        <input id="password" name="password" type="password" autoComplete="current-password" defaultValue="super-secret-password" />
        <input type="hidden" name="csrf_token" defaultValue="csrf-secret-value" />
        <button type="submit">Save settings</button>
      </form>
      <button
        type="button"
        onClick={() => {
          void fetch("/api/admin/delete-account", { method: "POST" });
        }}
      >
        Delete account
      </button>
    </section>
  );
}

function Activity() {
  return (
    <section>
      <h1>Activity</h1>
      <p>No client-side events yet.</p>
    </section>
  );
}
