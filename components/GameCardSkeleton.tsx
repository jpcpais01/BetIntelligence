export default function GameCardSkeleton() {
  return (
    <div className="rounded-3xl border border-border-soft bg-surface/70 p-4 sm:p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="skeleton h-6 w-28 rounded-full" />
        <div className="skeleton h-6 w-20 rounded-full" />
      </div>
      <div className="space-y-3 mb-4">
        <div className="flex items-center gap-3">
          <div className="skeleton h-7 w-7 rounded-full" />
          <div className="skeleton h-3 flex-1 rounded-full" />
        </div>
        <div className="skeleton h-2 w-full rounded-full ml-10" />
        <div className="flex items-center gap-3">
          <div className="skeleton h-7 w-7 rounded-full" />
          <div className="skeleton h-3 flex-1 rounded-full" />
        </div>
        <div className="skeleton h-2 w-full rounded-full ml-10" />
      </div>
      <div className="flex items-center justify-between border-t border-border-soft pt-3">
        <div className="skeleton h-3 w-16 rounded-full" />
        <div className="skeleton h-8 w-24 rounded-full" />
      </div>
    </div>
  );
}
