import { Brand } from "@/components/brand";
import { Navigation } from "@/components/navigation";
import { requireDashboard } from "@/lib/dashboard";
import { signOut } from "@/auth";

export const dynamic = "force-dynamic";
export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  await requireDashboard();
  async function logout() { "use server"; await signOut({ redirectTo: "/signin" }); }
  return <div className="app-shell"><a className="skip-link" href="#main-content">Skip to content</a><aside className="sidebar"><Brand compact/><p className="eyebrow sidebar-label">Posting Center</p><Navigation/><div className="sidebar-footer"><p>Private media portal</p><form action={logout}><button className="button quiet">Sign out</button></form></div></aside><div className="app-main"><header className="mobile-header"><Brand compact/><form action={logout}><button className="button quiet">Sign out</button></form></header><main id="main-content">{children}</main></div><div className="mobile-navigation"><Navigation/></div></div>;
}
