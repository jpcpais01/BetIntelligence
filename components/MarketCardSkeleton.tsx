export default function MarketCardSkeleton() {
  return (
    <div className="rounded-md border p-4" style={{ borderColor: "var(--d-border)", background: "var(--d-surface)" }}>
      <div className="mb-3 flex items-center justify-between">
        <div className="skeleton h-5 w-20 rounded-sm" />
        <div className="skeleton h-5 w-12 rounded-sm" />
      </div>
      <div className="mb-3.5 space-y-1.5">
        <div className="skeleton h-3 w-full rounded-sm" />
        <div className="skeleton h-3 w-2/3 rounded-sm" />
      </div>
      <div className="mb-3.5 skeleton h-9 w-20 rounded-sm" />
      <div className="mb-3.5 skeleton h-2 w-full rounded-sm" />
      <div className="flex items-center justify-between">
        <div className="skeleton h-3 w-20 rounded-sm" />
        <div className="skeleton h-8 w-24 rounded-sm" />
      </div>
    </div>
  );
}
