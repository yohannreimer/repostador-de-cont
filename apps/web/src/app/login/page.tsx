"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

function sanitizeNext(raw: string | null): string {
  if (!raw || !raw.startsWith("/")) {
    return "/";
  }
  if (raw.startsWith("//")) {
    return "/";
  }
  return raw;
}

export default function LoginPage() {
  const router = useRouter();
  const [nextPath, setNextPath] = useState("/");

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const query = new URLSearchParams(window.location.search);
    setNextPath(sanitizeNext(query.get("next")));
  }, []);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    setLoading(true);

    try {
      const response = await fetch("/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username,
          password,
          next: nextPath
        })
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => ({ error: "Falha no login." }))) as {
          error?: string;
        };
        throw new Error(payload.error || "Falha no login.");
      }

      const payload = (await response.json()) as { redirectTo?: string };
      router.replace(sanitizeNext(payload.redirectTo ?? nextPath));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha no login.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-slate-100 p-4">
      <div className="pointer-events-none absolute -left-24 -top-20 h-72 w-72 rounded-full bg-cyan-200/35 blur-3xl" />
      <div className="pointer-events-none absolute -right-20 top-16 h-72 w-72 rounded-full bg-emerald-200/30 blur-3xl" />

      <section className="w-full max-w-md rounded-3xl border border-slate-200 bg-white/95 p-6 shadow-xl backdrop-blur">
        <p className="inline-flex rounded-full border border-slate-300 bg-slate-100 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-slate-700">
          Acesso restrito
        </p>
        <h1 className="mt-4 text-2xl font-black tracking-tight text-slate-900">
          Entrar no Authority Pack
        </h1>
        <p className="mt-2 text-sm text-slate-600">
          Informe login e senha para acessar o workspace.
        </p>

        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          <div>
            <label htmlFor="username" className="text-xs font-semibold uppercase tracking-wide text-slate-600">
              Login
            </label>
            <input
              id="username"
              type="text"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-slate-500"
              autoComplete="username"
              required
            />
          </div>

          <div>
            <label htmlFor="password" className="text-xs font-semibold uppercase tracking-wide text-slate-600">
              Senha
            </label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-slate-500"
              autoComplete="current-password"
              required
            />
          </div>

          {error ? (
            <p className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-medium text-red-700">
              {error}
            </p>
          ) : null}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-70"
          >
            {loading ? "Entrando..." : "Entrar"}
          </button>
        </form>
      </section>
    </main>
  );
}
