"use client";

import { useActionState } from "react";
import { connectExchange, type ConnectState } from "@/app/actions";
import { SubmitButton } from "@/components/SubmitButton";

interface Labels {
  title: string;
  hint: string;
  url: string;
  username: string;
  password: string;
  email: string;
  auth: string;
  connect: string;
  connected: string;
}

export function ExchangeConnectForm({
  labels,
  fixedUrl,
  defaultEmail,
}: {
  labels: Labels;
  fixedUrl: string | null;
  defaultEmail: string;
}) {
  const [state, action] = useActionState<ConnectState, FormData>(connectExchange, null);
  return (
    <form action={action} className="stack">
      <h3>{labels.title}</h3>
      <p className="small muted">{labels.hint}</p>
      {fixedUrl ? (
        <p className="small">🖥️ {fixedUrl}</p>
      ) : (
        <div>
          <label>{labels.url}</label>
          <input type="text" name="ews_url" required placeholder="https://mail.firma.de/EWS/Exchange.asmx" />
        </div>
      )}
      <div className="grid">
        <div>
          <label>{labels.email}</label>
          <input type="email" name="account_email" required defaultValue={defaultEmail} />
        </div>
        <div>
          <label>{labels.username}</label>
          <input type="text" name="username" required autoComplete="username" />
        </div>
        <div>
          <label>{labels.password}</label>
          <input type="password" name="password" required autoComplete="current-password" style={{ width: "100%" }} />
        </div>
        <div>
          <label>{labels.auth}</label>
          <select name="auth_type" defaultValue="ntlm">
            <option value="ntlm">NTLM (Standard)</option>
            <option value="basic">Basic</option>
          </select>
        </div>
      </div>
      <SubmitButton pendingText="⏳">{labels.connect}</SubmitButton>
      {state && (
        <p className={state.ok ? "small" : "error small"}>
          {state.ok ? `${labels.connected} ${state.message.replace("✅ ", "")}` : state.message}
        </p>
      )}
    </form>
  );
}
