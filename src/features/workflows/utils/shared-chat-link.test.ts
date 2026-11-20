import { describe, expect, it } from 'vitest';
import {
  isSharedChatPath,
  orgOfRuntimeBase,
  readSharedChatLink,
  sharedChatApi,
  sharedChatLink,
} from './shared-chat-link';

const chat = {
  workflowId: 'baf40c7b-b34d-483b-90f5-eaac859ee389',
  key: 'console:a b/c',
  token: 'rtc_secret',
  org: 'acme',
  sender: 'link:1',
  expiresAt: '2026-11-21T06:00:00Z',
};

describe('a link to one conversation', () => {
  it('carries what the page needs in the fragment, and reads it back', () => {
    const link = sharedChatLink('https://console.example/ui/acme/', chat);
    const url = new URL(link);
    expect(url.pathname).toBe('/ui/acme/shared-chat');
    // Nothing of it is in what a server is sent.
    expect(url.search).toBe('');
    expect(url.pathname).not.toContain('rtc_');
    expect(readSharedChatLink(url.hash)).toEqual(chat);
  });

  it('leaves out what is not known', () => {
    const { org, sender, expiresAt, ...needed } = chat;
    void [org, sender, expiresAt];
    const link = sharedChatLink('http://localhost:8081/', needed);
    expect(readSharedChatLink(new URL(link).hash)).toEqual(needed);
  });

  it.each([
    ['', 'nothing'],
    ['#workflow=wf&key=k', 'no token'],
    [
      '#workflow=wf&key=k&token=not-a-conversation-token',
      'another kind of token',
    ],
    ['#workflow=..%2Fx&key=k&token=rtc_x', 'a workflow that is a path'],
    ['#workflow=wf&key=k&token=rtc_x&org=..%2F..', 'a tenant that is a path'],
  ])('reads %j as no link (%s)', (hash) => {
    expect(readSharedChatLink(hash)).toBeNull();
  });

  it("is read from the deployment's API, under the link's tenant", () => {
    expect(sharedChatApi('https://api.example/', 'acme')).toBe(
      'https://api.example/api/runtime/acme'
    );
    expect(sharedChatApi('', undefined)).toBe('/api/runtime');
  });

  it("takes the tenant from the console's runtime API address", () => {
    expect(orgOfRuntimeBase('https://api.example/api/runtime/acme')).toBe(
      'acme'
    );
    expect(
      orgOfRuntimeBase('http://localhost:7301/api/runtime')
    ).toBeUndefined();
  });

  it('knows its page wherever the console is mounted', () => {
    expect(isSharedChatPath('/shared-chat')).toBe(true);
    expect(isSharedChatPath('/ui/acme/shared-chat/')).toBe(true);
    expect(isSharedChatPath('/ui/acme/workflows')).toBe(false);
    expect(isSharedChatPath('/workflows/shared-chat-x')).toBe(false);
  });
});
