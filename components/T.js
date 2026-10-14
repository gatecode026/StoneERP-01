'use client';
import { useApp } from './Providers';

/** Screen text that is plain English in the source: `<T>Save</T>` shows the Hindi when the language is Hindi (and the phrase is in lib/hi.js). */
export default function T({ children, vars }) {
  const { tr } = useApp();
  return typeof children === 'string' ? tr(children.replace(/\s+/g, ' ').trim(), vars) : children;
}
