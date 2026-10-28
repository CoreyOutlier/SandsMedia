import Link from "next/link";
export default function NotFound() { return <main className="simple-message"><h1>Page not found</h1><p>This page isn’t available.</p><Link className="button primary" href="/patients">Back to portal</Link></main>; }
