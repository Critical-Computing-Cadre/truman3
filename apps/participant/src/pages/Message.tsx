export function Message({ title, body }: { title: string; body?: string }) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-3 p-6 text-center">
      <h1 className="text-2xl font-semibold">{title}</h1>
      {body && <p className="text-stone-600">{body}</p>}
    </main>
  );
}
