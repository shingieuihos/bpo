export default function Loading() {
  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-4 p-6">
      <div className="h-8 w-56 animate-pulse rounded-md bg-muted" />
      <div className="h-4 w-80 animate-pulse rounded-md bg-muted" />
      <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-24 animate-pulse rounded-xl bg-muted" />
        ))}
      </div>
      <div className="h-72 animate-pulse rounded-xl bg-muted" />
    </main>
  );
}
