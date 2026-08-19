/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_DEBUG_TOOLS?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
