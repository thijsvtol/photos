/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL?: string;
  readonly VITE_APP_NAME?: string;
  readonly VITE_BRAND_NAME?: string;
  readonly VITE_COPYRIGHT_HOLDER?: string;
  readonly VITE_DOMAIN?: string;
  readonly VITE_CONTACT_EMAIL?: string;
  readonly VITE_GA_MEASUREMENT_ID?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
