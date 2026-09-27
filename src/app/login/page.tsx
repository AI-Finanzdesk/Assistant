"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/browser";
import { dict } from "@/lib/i18n";

export default function LoginPage() {
  const [lang, setLang] = useState<"nl" | "de">("nl");
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const t = dict(lang);

  useEffect(() => {
    if (navigator.language.toLowerCase().startsWith("de")) setLang("de");
    // Uitnodigingslinks van Supabase leveren de sessie in de URL-hash af.
    const hash = new URLSearchParams(window.location.hash.slice(1));
    const access_token = hash.get("access_token");
    const refresh_token = hash.get("refresh_token");
    if (access_token && refresh_token) {
      createClient()
        .auth.setSession({ access_token, refresh_token })
        .then(({ error }) => {
          if (!error) window.location.replace("/");
        });
    }
    if (new URLSearchParams(window.location.search).get("error")) setState("error");
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setState("sending");
    const { error } = await createClient().auth.signInWithOtp({
      email,
      options: { shouldCreateUser: false, emailRedirectTo: `${window.location.origin}/auth/callback` },
    });
    setState(error ? "error" : "sent");
  }

  return (
    <div style={{ maxWidth: 380, margin: "12vh auto", padding: "0 1rem" }}>
      <div className="card stack">
        <h1>{t.appName}</h1>
        <p className="muted">{t.login_intro}</p>
        <form onSubmit={submit} className="stack">
          <div>
            <label htmlFor="email">{t.login_email}</label>
            <input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <button type="submit" disabled={state === "sending"}>
            {t.login_send}
          </button>
        </form>
        {state === "sent" && <p>{t.login_sent}</p>}
        {state === "error" && <p className="error">{t.login_error}</p>}
        <div className="row small">
          <button className="ghost small" onClick={() => setLang("nl")}>NL</button>
          <button className="ghost small" onClick={() => setLang("de")}>DE</button>
        </div>
      </div>
    </div>
  );
}
