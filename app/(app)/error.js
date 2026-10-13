'use client';

// A failure inside one screen shows here; the navigation around it keeps working.
export default function ScreenError({ error, reset }) {
  return (
    <div role="alert" className="card p-5 max-w-md mx-auto mt-8 text-center">
      <h2 className="font-bold text-lg mb-1">Something went wrong on this screen</h2>
      <p className="text-sm text-char-500 mb-4">Your saved entries are safe. {error?.digest ? `Reference: ${error.digest}` : ''}</p>
      <button className="btn-primary" onClick={() => reset()}>Try again</button>
    </div>
  );
}
