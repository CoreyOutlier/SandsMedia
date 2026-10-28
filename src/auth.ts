import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { canSignIn, isAllowedEmail, safeRedirect } from "./lib/access";
import { reportError } from "./lib/log";

export function authConfigured() {
  return Boolean(process.env.AUTH_SECRET && process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET && process.env.APP_URL);
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [Google({
    clientId: process.env.AUTH_GOOGLE_ID ?? "",
    clientSecret: process.env.AUTH_GOOGLE_SECRET ?? "",
  })],
  secret: process.env.AUTH_SECRET,
  trustHost: true,
  session: { strategy: "jwt", maxAge: 8 * 60 * 60 },
  pages: { signIn: "/signin", error: "/signin" },
  debug: false,
  logger: {
    error() { reportError("AUTH_ERROR"); },
    warn() { reportError("AUTH_WARNING"); },
    debug() {},
  },
  callbacks: {
    signIn({ account, profile }) { return canSignIn(account?.provider, profile, process.env.ALLOWED_EMAILS); },
    jwt({ token, account, profile }) {
      if (account) token.verifiedGoogle = canSignIn(account.provider, profile, process.env.ALLOWED_EMAILS);
      return token;
    },
    session({ session, token }) {
      // Re-evaluate the allowlist so removal invalidates an existing session.
      if (token.verifiedGoogle !== true || !isAllowedEmail(token.email, process.env.ALLOWED_EMAILS)) {
        session.user.email = "";
      }
      return session;
    },
    redirect({ url, baseUrl }) { return safeRedirect(url, process.env.APP_URL ?? baseUrl); },
  },
});
