export default function NeapolitanPage() {
  return (
    <section className="scoop-panel">
      <h2>Neapolitan</h2>
      <p className="muted">
        All watched coins, color-coded by tip presence. Sync and coin rows land in the next Scoop
        slices — this scaffold ships theme tokens, chrome, and the Drizzle schema.
      </p>
      <div className="legend" aria-label="Presence legend">
        <span className="presence-chip core">Core only</span>
        <span className="presence-chip knots">Knots only</span>
        <span className="presence-chip both">Both</span>
      </div>
    </section>
  );
}
