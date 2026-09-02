export default function GameCardSkeleton() {
  return (
    <div className="rounded-2xl border border-border-soft bg-surface p-4">
      <div className="mb-3.5 flex items-center justify-between">
        <div className="skeleton h-3 w-24 rounded-full" />
        <div className="skeleton h-3 w-16 rounded-full" />
      </div>
      <div className="mb-4 space-y-3">
        <div className="flex items-center gap-2.5">
          <div className="skeleton h-[26px] w-[26px] rounded-full" />
          <div className="flex-1 space-y-1.5">
            <div className="skeleton h-2.5 w-28 rounded-full" />
            <div className="skeleton h-1 w-full rounded-full" />
          </div>
        </div>
        <div className="skeleton ml-9 h-1 w-full rounded-full" />
        <div className="flex items-center gap-2.5">
          <div className="skeleton h-[26px] w-[26px] rounded-full" />
          <div className="flex-1 space-y-1.5">
            <div className="skeleton h-2.5 w-24 rounded-full" />
            <div className="skeleton h-1 w-full rounded-full" />
          </div>
        </div>
      </div>
      <div className="flex items-center justify-between border-t border-border-soft pt-3">
        <div className="skeleton h-3 w-14 rounded-full" />
        <div className="skeleton h-8 w-24 rounded-full" />
      </div>
    </div>
  );
}
