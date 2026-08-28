export default function Loading() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background">
      <span
        aria-label="Loading"
        className="size-6 animate-spin rounded-full border-2 border-input border-t-primary"
      />
    </main>
  );
}
