"use client";

/**
 * Petit magasin `localStorage` compatible `useSyncExternalStore`.
 *
 * Pourquoi ce detour plutôt qu'un `useEffect` de lecture : React considere
 * `localStorage` comme un système externe. `useSyncExternalStore` gère
 * proprement le rendu serveur (valeur par défaut) puis l'hydratation (valeur
 * réelle), sans cascade de rendus ni mise à jour d'état dans un effet.
 *
 * Rien de sensible n'est stocke ici : la clé API ne quitte jamais le serveur.
 */

export interface LocalStore<T> {
  subscribe: (listener: () => void) => () => void;
  getSnapshot: () => T;
  getServerSnapshot: () => T;
  set: (value: T) => void;
}

export function createLocalStore<T>(options: {
  key: string;
  defaultValue: T;
  serialize: (value: T) => string;
  deserialize: (raw: string) => T;
}): LocalStore<T> {
  const { key, defaultValue, serialize, deserialize } = options;
  const listeners = new Set<() => void>();

  // `useSyncExternalStore` exige une identite de snapshot stable : la valeur
  // lue est donc mise en cache et ne change que via `set`.
  let cache: { value: T } | null = null;

  function read(): T {
    try {
      const raw = window.localStorage.getItem(key);
      return raw === null ? defaultValue : deserialize(raw);
    } catch {
      // Navigation privée, stockage bloqué, JSON corrompu : on dégrade en douceur.
      return defaultValue;
    }
  }

  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot() {
      if (cache === null) cache = { value: read() };
      return cache.value;
    },
    getServerSnapshot() {
      return defaultValue;
    },
    set(value) {
      cache = { value };
      try {
        window.localStorage.setItem(key, serialize(value));
      } catch {
        // La perte de persistance ne doit jamais casser l'application.
      }
      for (const listener of listeners) listener();
    },
  };
}
