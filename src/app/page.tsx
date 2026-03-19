import GameCanvas from "./components/GameCanvas"

export default function Home() {
  return (
    <main
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        marginTop: "40px",
        gap: "5px"
      }}
    >
      
      <p>Stop the drop at the perfect count.</p>

      <GameCanvas />

      <footer
        style={{
          marginTop: "40px",
          padding: "20px",
          fontSize: "12px",
          textAlign: "center",
          opacity: 0.6
        }}
      >
        <a href="/links">Links</a> · <a href="/imprint">Imprint</a> ·{" "}
        <a href="/privacy">Privacy</a> · <a href="/terms">Terms</a>
      </footer>
    </main>
  )
}