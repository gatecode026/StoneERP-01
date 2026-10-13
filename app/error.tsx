'use client';

export default function RootError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div role="alert" className="min-h-screen flex items-center justify-center p-6">
      <div className="card p-6 max-w-sm text-center">
        <h1 className="font-bold text-lg mb-2">Something went wrong</h1>
        <p className="text-sm text-char-500 mb-4">Please try again. If it keeps happening, tell the Owner.</p>
        <button className="btn-primary" onClick={() => reset()}>Try again</button>
      </div>
    </div>
  );
}
