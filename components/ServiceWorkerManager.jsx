"use client";

import { useEffect } from "react";

export default function ServiceWorkerManager() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    if (process.env.NODE_ENV === "development") {
      navigator.serviceWorker.getRegistrations()
        .then((registrations) => Promise.all(registrations.map((registration) => registration.unregister())))
        .then(() => caches.keys())
        .then((keys) => Promise.all(keys.filter((key) => key.startsWith("easyroom-")).map((key) => caches.delete(key))))
        .catch(() => {});
      return;
    }

    navigator.serviceWorker.register("/sw.js")
      .then((registration) => registration.update())
      .catch(() => {});
  }, []);

  return null;
}
