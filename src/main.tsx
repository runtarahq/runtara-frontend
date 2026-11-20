import { loadStaticConfig } from '@/shared/config/staticConfig';
import { isSharedChatPath } from '@/features/workflows/utils/shared-chat-link';

// Boot in two stages: a deployment's config.json has to be in place before
// any module reads the runtime config, and most of the app reads it when it is
// first imported. So the app is imported only once the config is settled.
//
// A link to one conversation opens a page of its own, for someone who has a
// conversation token and no account: the console, which would ask them to
// sign in, is not loaded for it.
void loadStaticConfig().then((boot) => {
  if (!boot) return;
  if (isSharedChatPath(window.location.pathname)) void import('./shared-chat');
  else void import('./bootstrap');
});
