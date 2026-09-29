import { cn } from "@/lib/utils"

export type Segment<T extends string | number> = {
  value: T
  label: string
  icon?: React.ReactNode
  /** For a segment with no visible label, and the hover hint for one that has. */
  title?: string
}

/**
 * A segmented control: one bordered container holding mutually exclusive
 * segments.
 *
 * Shared rather than written twice. On the detail page two rows of identical blue
 * pills sat one above the other and nothing said that the top row picked a view
 * and the bottom one a time range; giving each row its own container is what makes
 * them two controls instead of one confusing set. The list page's view switch is
 * the same object with icons instead of words.
 */
export function Segmented<T extends string | number>({ items, value, onChange, label, className }: {
  items: Segment<T>[]
  value: T
  onChange: (value: T) => void
  label: string
  className?: string
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className={cn("inline-flex h-8 shrink-0 items-center gap-0.5 rounded-md border bg-card px-0.5 max-sm:h-10", className)}
    >
      {items.map((item) => {
        const active = item.value === value
        return (
          <button
            key={item.value}
            type="button"
            onClick={() => onChange(item.value)}
            aria-pressed={active}
            aria-label={item.title ?? item.label}
            title={item.title}
            className={cn(
              // `max-sm:h-8`: a 24px segment inside a 32px frame is a mouse target,
              // and this row is the only control on the page a phone visitor has to
              // hit. The ring is what every other control here already shows on a
              // keyboard pass; these had only the browser's default.
              "inline-flex h-6 items-center gap-1.5 rounded text-xs whitespace-nowrap transition-colors max-sm:h-8",
              "focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none",
              item.label === "" ? "px-1.5" : "px-2",
              active ? "bg-accent text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            {item.icon}
            {item.label}
          </button>
        )
      })}
    </div>
  )
}
