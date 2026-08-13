"use client";

import { useEffect, useRef } from "react";
import { AlertTriangle, Inbox, X } from "lucide-react";

export function PageHeader({ title, description, action }) {
  return <div className="page-header"><div><h1>{title}</h1>{description && <p>{description}</p>}</div>{action}</div>;
}

export function EmptyState({ title, description, action }) {
  return <div className="empty-state"><div className="empty-icon"><Inbox size={22} /></div><strong>{title}</strong>{description && <p>{description}</p>}{action}</div>;
}

export function Skeleton({ className = "" }) {
  return <div className={`skeleton ${className}`} aria-hidden="true" />;
}

export function Dialog({ open, title, description, children, onClose, danger = false }) {
  const panel = useRef(null);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement;
    panel.current?.focus();
    const escape = (event) => { if (event.key === "Escape") onCloseRef.current?.(); };
    document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("keydown", escape); previous?.focus?.(); };
  }, [open]);
  if (!open) return null;
  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose?.(); }}>
      <div className="dialog-panel" role="dialog" aria-modal="true" aria-labelledby="dialog-title" tabIndex={-1} ref={panel}>
        <div className="dialog-heading">
          <div className={danger ? "dialog-danger-icon" : "empty-icon"}>{danger ? <AlertTriangle size={20} /> : <Inbox size={20} />}</div>
          <div><h2 id="dialog-title">{title}</h2>{description && <p>{description}</p>}</div>
          <button className="icon-button dialog-close" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>
        {children}
      </div>
    </div>
  );
}
