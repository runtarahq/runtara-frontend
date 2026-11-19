import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider } from 'react-oidc-context';
import { Toaster } from '@/shared/components/ui/sonner';
import { createOidcConfig } from '@/shared/config/oidcConfig';
import { initAnalytics } from '@/shared/analytics/plausible';
import { queryClient } from '@/shared/queries/query-client';
import App from '@/App';

// Self-hosted Inter (variable font) — the primary face declared in
// tailwind.config.js fontFamily.sans; without this import the app silently
// fell back to Roboto/system-ui.
import '@fontsource-variable/inter';
import './index.css';

initAnalytics();

// Sign-in settings, worked out here: a deployment missing them fails as
// it boots, with a message that says which.
const oidcConfig = createOidcConfig();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AuthProvider {...oidcConfig}>
      <QueryClientProvider client={queryClient}>
        <App />
        <Toaster />
      </QueryClientProvider>
    </AuthProvider>
  </StrictMode>
);
