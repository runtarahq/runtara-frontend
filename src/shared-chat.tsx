// The entry of the shared chat page (see main.tsx): one conversation, for
// the holder of a link to it. Nothing of the console is loaded with it: no
// sign-in, no router, no tenant and no user, since a conversation token is
// taken by its conversation's routes only.
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { config } from '@/shared/config/runtimeConfig';
import { readConversationsAt } from '@/features/workflows/queries/conversations';
import { SharedChatPage } from '@/features/workflows/pages/SharedChat';
import {
  readSharedChatLink,
  sharedChatApi,
} from '@/features/workflows/utils/shared-chat-link';

import '@fontsource-variable/inter';
import './index.css';

const chat = readSharedChatLink(window.location.hash);
if (chat) readConversationsAt(sharedChatApi(config.apiBaseUrl, chat.org));

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <SharedChatPage chat={chat} />
  </StrictMode>
);
