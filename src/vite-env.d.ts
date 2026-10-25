/// <reference types="vite/client" />

declare const firebase: {
  apps?: unknown[];
  initializeApp?: (c: unknown) => void;
  database?: () => { ref: (p: string) => { once: (e: string) => Promise<{ val: () => unknown }> } };
} | undefined;
