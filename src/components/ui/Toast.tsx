"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { CircleCheck } from "lucide-react";

const DISMISS_AFTER_MS = 3000;

type ToastItem = { id: number; message: string };
type ToastContextValue = { toast: (message: string) => void };

const ToastContext = createContext<ToastContextValue | null>(null);

/** Toast shell. Mount once in the workspace layout; call `useToast().toast("Saved")` from any client component. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const nextId = useRef(0);
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());

  const toast = useCallback((message: string) => {
    const id = nextId.current++;
    setToasts((current) => [...current, { id, message }]);
    const timer = setTimeout(() => {
      timers.current.delete(timer);
      setToasts((current) => current.filter((item) => item.id !== id));
    }, DISMISS_AFTER_MS);
    timers.current.add(timer);
  }, []);

  useEffect(() => {
    const pending = timers.current;
    return () => pending.forEach(clearTimeout);
  }, []);

  const value = useMemo(() => ({ toast }), [toast]);

  return (
    <ToastContext value={value}>
      {children}
      <div
        role="status"
        aria-live="polite"
        className="pointer-events-none fixed right-6 bottom-6 z-50 flex flex-col gap-2"
      >
        {toasts.map((item) => (
          <div
            key={item.id}
            className="pointer-events-auto flex items-center gap-2 rounded-btn bg-ink px-4 py-2.5 text-xs font-medium text-white shadow-overlay"
          >
            <CircleCheck aria-hidden className="size-4 text-positive-soft" />
            {item.message}
          </div>
        ))}
      </div>
    </ToastContext>
  );
}

export function useToast(): ToastContextValue {
  const context = useContext(ToastContext);
  if (!context) throw new Error("useToast must be used inside <ToastProvider>.");
  return context;
}
