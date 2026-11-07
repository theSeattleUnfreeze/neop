import Link from "next/link";

const STEPS = [
  { id: "garnish", href: "/garnish", label: "Garnish" },
  { id: "broadcast", href: "/broadcast", label: "Broadcast" },
  { id: "watch", href: "/broadcast#watch", label: "Watch" },
] as const;

export function SplitSteps({ current }: { current: (typeof STEPS)[number]["id"] }) {
  return (
    <ol className="split-steps">
      {STEPS.map((step, index) => (
        <li key={step.id} className={step.id === current ? "current" : undefined}>
          <Link href={step.href}>
            {index + 1}. {step.label}
          </Link>
        </li>
      ))}
    </ol>
  );
}
