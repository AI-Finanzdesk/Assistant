import Link from "next/link";
import { redirect } from "next/navigation";
import { dict } from "@/lib/i18n";
import { requireUser } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";

async function logout() {
  "use server";
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { profile } = await requireUser();
  const t = dict(profile.language);
  const nav = [
    { href: "/", label: t.nav_home, icon: "🏠" },
    { href: "/projects", label: t.nav_projects, icon: "📁" },
    { href: "/meetings", label: t.nav_meetings, icon: "🎙️" },
    { href: "/tasks", label: t.nav_tasks, icon: "✅" },
    ...(profile.is_internal ? [{ href: "/knowledge", label: t.nav_knowledge, icon: "📚" }] : []),
    { href: "/settings", label: t.nav_settings, icon: "⚙️" },
  ];

  return (
    <div className="shell">
      <nav className="sidebar">
        <div className="brand">{t.appName}</div>
        {nav.map((n) => (
          <Link key={n.href} href={n.href}>
            {n.icon} {n.label}
          </Link>
        ))}
        <div className="spacer" />
        <div className="small muted">{profile.full_name ?? profile.email}</div>
        <form action={logout}>
          <button className="ghost small" type="submit">
            {t.logout}
          </button>
        </form>
      </nav>
      <main className="main">{children}</main>
      <nav className="bottomnav">
        {nav.map((n) => (
          <Link key={n.href} href={n.href}>
            <span>{n.icon}</span>
            {n.label}
          </Link>
        ))}
      </nav>
    </div>
  );
}
