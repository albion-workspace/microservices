/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_AUTH_SERVICE_URL?: string
  readonly VITE_JWT_SECRET?: string
  readonly VITE_SHARED_JWT_SECRET?: string
  // Add other env variables as needed
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
