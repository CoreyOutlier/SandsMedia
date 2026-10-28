"use client";
export default function ErrorPage({ reset }: { reset: () => void }) { return <main className="simple-message"><h1>Something went wrong.</h1><p>Please try again.</p><button className="button primary" onClick={reset}>Try again</button></main>; }
