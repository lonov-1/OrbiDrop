import GameCanvas from "./components/GameCanvas"
import ScaleToFit from "./components/ScaleToFit"

export default function Home() {
  return (
    <main className="orbifall-main">
      <ScaleToFit>
        <div className="orbifall-game-wrap">
          <GameCanvas />
        </div>

        <footer
          className="orbifall-footer"
          style={{
            marginTop: "20px",
            padding: "16px",
            fontSize: "12px",
            textAlign: "center",
            opacity: 0.6
          }}
        >
          <a href="/links">Links</a> · <a href="/imprint">Imprint</a> ·{" "}
          <a href="/privacy">Privacy</a> · <a href="/terms">Terms</a>
        </footer>
      </ScaleToFit>
    </main>
  )
}