import Link from "next/link";

const TUTORIALS = [
  {
    href: "/howto/garnish",
    title: "Garnish Core PSBTs",
    summary:
      "Add a temporary OP_RETURN to unsigned Sparrow files so the same transaction cannot confirm on Knots while reduced-data rules hold, then sign.",
  },
];

export default function HowToPage() {
  return (
    <div className="scoop-stack">
      <section className="scoop-panel">
        <h2>How to</h2>
        <p className="muted">
          Walkthroughs for work you do with Scoop on this machine. Scoop watches, catalogs, and
          prepares files. Signing and broadcasting stay in Sparrow, Shrike, and your node.
        </p>
        <ul className="howto-index">
          {TUTORIALS.map((item) => (
            <li key={item.href}>
              <Link href={item.href}>{item.title}</Link>
              <p>{item.summary}</p>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
