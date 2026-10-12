'use client';
import { Sheet } from '@/components/ui';
import { isSafeImageSrc } from '@/lib/safeUrl';

// Safe replacement for window.open().document.write(): renders an allow-listed image inside our own modal.
export default function DocViewer({ src, title, onClose }) {
  return (
    <Sheet open={!!src} onClose={onClose} title={title || 'Document'} wide>
      {src && isSafeImageSrc(src)
        ? <img src={src} alt={title || 'document'} className="max-w-full mx-auto rounded-lg border border-sand-200" />
        : <div className="text-sm text-red-600">This file cannot be shown.</div>}
    </Sheet>
  );
}
