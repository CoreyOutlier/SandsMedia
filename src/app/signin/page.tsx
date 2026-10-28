import { Brand } from "@/components/brand";
import { Icon } from "@/components/icons";
import { authConfigured, signIn } from "@/auth";
import { AuthError } from "next-auth";
import { redirect } from "next/navigation";
import { reportError } from "@/lib/log";

export const dynamic = "force-dynamic";
export default async function SignIn({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const error = Boolean((await searchParams).error);
  const ready = authConfigured();
  async function login() {
    "use server";
    if (!authConfigured()) return;
    try { await signIn("google", { redirectTo: "/patients" }); }
    catch (error) {
      if (error instanceof AuthError) redirect("/signin?error=access");
      if (error && typeof error === "object" && "digest" in error && typeof error.digest === "string" && error.digest.startsWith("NEXT_REDIRECT;")) throw error;
      reportError("AUTH_ERROR");
      redirect("/signin?error=access");
    }
  }
  return <main className="signin-page">
    <header className="signin-header"><Brand/><span className="private-label"><Icon name="lock"/>Private team access</span></header>
    <div className="signin-content"><section className="signin-story"><p className="eyebrow">The Dr. Sands media portal</p><h1>Every smile.<br/>Every story.<br/><span>One place.</span></h1>
      <p className="signin-intro">A private home for the photos and footage behind the practice.</p>
      <div className="library-previews"><div><Icon name="patients"/><h2>Patients</h2><p>Before and afters, testimonials,<br/>and consent in one place.</p></div><div><Icon name="media"/><h2>Other uploads</h2><p>Raw footage, team content,<br/>and everyday clinic moments.</p></div></div>
    </section><section className="signin-card" aria-labelledby="signin-heading"><span className="eyebrow">Welcome to Posting Center</span><h2 id="signin-heading">Your work starts here.</h2><p>Sign in with your approved Google account to access the private media libraries.</p>
      {error && <p className="form-error" role="alert">We couldn’t sign you in. Use an approved Google account, or contact your administrator.</p>}
      <form action={login}><button className="button primary" disabled={!ready}><span className="google-g" aria-hidden="true">G</span>{ready ? "Sign in with Google" : "Sign-in available soon"}<Icon name="arrow"/></button></form>
      {!ready && <p className="setup-copy">We’re finishing the secure connection. Please check back shortly.</p>}
      <div className="signin-card-footer"><Icon name="lock"/><span>For authorized clinic and agency team members.</span></div>
    </section></div><footer className="signin-footer"><span>Kevin B. Sands, DDS</span><span>Cosmetic Dentistry · Beverly Hills</span></footer>
  </main>;
}
