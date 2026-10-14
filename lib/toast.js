'use client';
import hot from 'react-hot-toast';
import { trNow } from '@/lib/trNow';

// react-hot-toast with the message translated first (plain-text messages only; anything else passes through untouched)
const t = (m) => (typeof m === 'string' ? trNow(m) : m);
const toast = (m, o) => hot(t(m), o);
toast.success = (m, o) => hot.success(t(m), o);
toast.error = (m, o) => hot.error(t(m), o);
toast.loading = (m, o) => hot.loading(t(m), o);
toast.dismiss = hot.dismiss;
toast.remove = hot.remove;
toast.custom = hot.custom;
toast.promise = hot.promise;
export default toast;
export const Toaster = hot.Toaster;
