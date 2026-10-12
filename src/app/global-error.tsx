"use client";

// Replaces the root layout when it fails, so it carries its own document and
// inline styles (global CSS and fonts are not loaded here).
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <html lang="en">
    <body style={{ margin: 0, minHeight: "100vh", display: "grid", placeItems: "center", background: "#f5f3ef", color: "#20211f", fontFamily: "Arial, sans-serif", padding: 24 }}>
      <title>Something went wrong — 42 Model Management</title>
      <div style={{ maxWidth: 420, textAlign: "center" }}>
        <p style={{ fontSize: 11, letterSpacing: ".2em", textTransform: "uppercase", color: "#6b6d66" }}>42 Model Management</p>
        <h1 style={{ fontSize: 32, margin: "12px 0" }}>We couldn&apos;t load the site</h1>
        <p style={{ fontSize: 14, lineHeight: 1.6, color: "#6b6d66" }}>Please try again in a moment.{error.digest ? ` Reference: ${error.digest}` : ""}</p>
        <button type="button" onClick={reset} style={{ marginTop: 24, padding: "10px 20px", border: "1px solid #20211f", background: "transparent", cursor: "pointer", fontSize: 12, letterSpacing: ".14em", textTransform: "uppercase" }}>Try again</button>
      </div>
    </body>
  </html>;
}
