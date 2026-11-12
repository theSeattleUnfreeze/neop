export function SyncMeter({
  label,
  ratio,
  tone,
}: {
  label: string;
  ratio: number | null;
  tone: "core" | "knots";
}) {
  const pct = ratio == null ? 0 : Math.round(ratio * 100);
  return (
    <div className="stack-sync">
      <p className="stack-sync-label">{label}</p>
      {ratio != null ? (
        <div
          className={`stack-sync-track tone-${tone}`}
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={pct}
          aria-label={label}
        >
          <div className="stack-sync-fill" style={{ width: `${pct}%` }} />
        </div>
      ) : null}
    </div>
  );
}
