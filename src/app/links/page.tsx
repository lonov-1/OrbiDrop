export default function LinksPage() {
  return (
    <main
      className="orbifall-legal-main"
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        marginTop: "40px",
        gap: "16px"
      }}
    >
      <h1>Links</h1>

      <p style={{ opacity: 0.8 }}>Quick access to legal pages.</p>

      <footer
        style={{
          marginTop: "40px",
          padding: "20px",
          fontSize: "12px",
          textAlign: "center",
          opacity: 0.6
        }}
      >
        <a href="/imprint">Imprint</a> · <a href="/privacy">Privacy</a> ·{" "}
        <a href="/terms">Terms</a>
      </footer>
    </main>
  )
}
