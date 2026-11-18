import { expect, type Page } from '@playwright/test';
import { test, buildWorkflow } from '../fixtures';
import type { MockApi } from '../fixtures/mock.fixture';
import { api, json } from './helpers';

declare global {
  interface Window {
    __sse: {
      opened: number;
      closed: number;
      push: (text: string) => void;
      close: () => void;
    };
  }
}

const INSTANCE = 'inst_audit';

/**
 * A fulfilled route closes its body at once, so the conversation's event
 * stream is answered from the page with a stream the test controls.
 * Everything else goes through Playwright routes as usual.
 */
async function installControlledStream(page: Page) {
  await page.addInitScript(() => {
    const realFetch = window.fetch.bind(window);
    let live: ReadableStreamDefaultController<Uint8Array> | null = null;
    const encoder = new TextEncoder();
    window.__sse = {
      opened: 0,
      closed: 0,
      push: (text) => live!.enqueue(encoder.encode(text)),
      close: () => {
        window.__sse.closed += 1;
        live!.close();
        live = null;
      },
    };
    window.fetch = (input, init) => {
      const url = typeof input === 'string' ? input : (input as Request).url;
      if (/\/conversations\/[^/]+\/events(\?|$)/.test(url)) {
        window.__sse.opened += 1;
        const body = new ReadableStream<Uint8Array>({
          start(controller) {
            live = controller;
            // A real fetch body errors on abort (StrictMode remounts abort).
            init?.signal?.addEventListener('abort', () => {
              try {
                controller.error(new DOMException('Aborted', 'AbortError'));
              } catch {
                // already closed
              }
            });
          },
        });
        return Promise.resolve(
          new Response(body, {
            status: 200,
            headers: { 'Content-Type': 'text/event-stream' },
          })
        );
      }
      return realFetch(input, init);
    };
  });
}

type Sent = { id: string; text?: string; payload?: unknown };

async function openChat(page: Page, mockApi: MockApi) {
  const wf = buildWorkflow({ id: 'wf_chat_audit', name: 'Chat audit' });
  const ctl = {
    /** Every message sent into the conversation, the opening one first. */
    posts: [] as Sent[],
    /** Status to answer the next message POST with. */
    nextStatus: (() => 200) as (s: Sent) => number,
  };
  await installControlledStream(page);
  await mockApi.bootstrap(page);
  await mockApi.workflows.get(page, wf.id!, wf);
  await page.route(
    api(`workflows/${wf.id}/instances/${INSTANCE}/pending-input`),
    (route) =>
      json(route, {
        success: true,
        data: { instanceId: INSTANCE, pendingInputs: [] },
      })
  );
  await page.route(
    new RegExp(`/workflows/${wf.id}/conversations/[^/]+/messages$`),
    (route) => {
      const s = route.request().postDataJSON() as Sent;
      ctl.posts.push(s);
      const status = ctl.nextStatus(s);
      return status === 200
        ? json(route, {
            success: true,
            data: { messageId: s.id, state: 'queued', duplicate: false },
          })
        : json(route, { success: false, message: 'gateway hiccup' }, status);
    }
  );
  await page.goto(`/workflows/${wf.id}/chat`);
  await expect(page.getByRole('heading', { name: 'Chat audit' })).toBeVisible({
    timeout: 15_000,
  });
  await expect
    .poll(() => page.evaluate(() => window.__sse.opened))
    .toBeGreaterThan(0);
  return ctl;
}

let seq = 0;
/** One event of the conversation, numbered as the server numbers them. */
const push = (page: Page, kind: string, body: Record<string, unknown> = {}) => {
  seq += 1;
  const event = { seq, kind, body, createdAt: new Date().toISOString() };
  return page.evaluate(
    (text) => window.__sse.push(text),
    `id: ${String(seq)}\nevent: ${kind}\ndata: ${JSON.stringify(event)}\n\n`
  );
};
const runStarted = (page: Page) =>
  push(page, 'run_started', { instanceId: INSTANCE, messageId: 'opening' });
const runEnded = (page: Page, status = 'completed') =>
  push(page, 'run_ended', {
    instanceId: INSTANCE,
    status,
    error: status === 'completed' ? null : 'turn failed',
  });

/** The real store, through the dev server's module graph. */
const chatState = (page: Page) =>
  page.evaluate(async () => {
    const path = '/src/features/workflows/stores/chatStore.ts';
    const { useChatStore } = await import(/* @vite-ignore */ path);
    const { status, conversationKey } = useChatStore.getState();
    return {
      status: status as string,
      conversationKey: conversationKey as string | null,
    };
  });

const input = (page: Page) => page.getByPlaceholder('Type a message...');
const bubble = (page: Page, text: string) =>
  page.locator('p').getByText(text, { exact: true });

/** Text, then Enter: the way a person sends. */
async function send(page: Page, text: string) {
  await input(page).fill(text);
  await input(page).press('Enter');
}

test.beforeEach(() => {
  seq = 0;
});

test.describe('Chat audit', () => {
  test('CH-2 After a send, the chat is not idle until the run it started has ended', async ({
    page,
    mockApi,
  }) => {
    const ctl = await openChat(page, mockApi);
    // The page opened a conversation of its own with a message that says
    // nothing, so the workflow speaks first.
    expect(ctl.posts[0].payload).toEqual({});
    expect((await chatState(page)).conversationKey).toMatch(/^console:/);
    await runStarted(page);
    await push(page, 'reply', { text: 'Hello, how can I help?' });
    await expect(page.getByText('Hello, how can I help?')).toBeVisible();

    // While a run carries the conversation the input refuses text, so a send
    // starts from `idle` or `error`, not from `streaming`.
    expect((await chatState(page)).status).toBe('streaming');
    await expect(input(page)).toBeDisabled();

    await runEnded(page);
    await expect(input(page)).toBeEnabled();

    await send(page, 'first question');
    await expect.poll(() => ctl.posts.length).toBe(2);
    await expect(bubble(page, 'first question')).toBeVisible();
    // The reply is on its way: what the page calls this.
    const whileReplying = (await chatState(page)).status;

    await push(page, 'run_started', {
      instanceId: INSTANCE,
      messageId: ctl.posts[1].id,
      text: 'first question',
    });
    await push(page, 'reply', { text: 'Working on it' });
    await expect(page.getByText('Working on it')).toBeVisible();
    // The page showed the message when it sent it, and not again.
    await expect(bubble(page, 'first question')).toHaveCount(1);

    // A run that fails leaves `error`, from which the next message is sent.
    await runEnded(page, 'failed');
    await expect.poll(async () => (await chatState(page)).status).toBe('error');
    await send(page, 'second question');
    await expect.poll(() => ctl.posts.length).toBe(3);
    await expect(bubble(page, 'second question')).toBeVisible();
    expect(await page.evaluate(() => window.__sse.closed)).toBe(0);

    expect(whileReplying).not.toBe('idle');
    // `error` is what the send left behind: not leaving it proves nothing.
    await expect
      .poll(async () =>
        ['idle', 'error'].includes((await chatState(page)).status)
      )
      .toBe(false);
  });

  test('CH-4 A new send keeps the earlier unconfirmed message on offer for retry', async ({
    page,
    mockApi,
  }) => {
    const ctl = await openChat(page, mockApi);
    await runStarted(page);
    await runEnded(page);
    await expect(input(page)).toBeEnabled();
    const banner = (text: string) =>
      page.getByText(`Message receipt is unconfirmed: ${text}`);
    const retry = (text: string) =>
      page.getByRole('button', { name: `Retry this message: ${text}` });
    const sent = () => ctl.posts.slice(1);

    // A: the acknowledgement is lost.
    ctl.nextStatus = () => 502;
    await send(page, 'message A');
    await expect(banner('message A')).toBeVisible();

    // Control: retrying A keeps its id, so the conversation takes it once.
    await retry('message A').click();
    await expect.poll(() => sent().length).toBe(2);
    expect(sent()[1].id).toBe(sent()[0].id);
    // Let the retry settle: a send during it is ignored by the enqueue guard.
    await page.waitForTimeout(300);

    // B fails too: A must still be on offer.
    await send(page, 'message B');
    await expect(banner('message B')).toBeVisible();
    await expect(banner('message A')).toHaveCount(1);

    // B goes through.
    ctl.nextStatus = () => 200;
    await retry('message B').click();
    await expect(bubble(page, 'message B')).toBeVisible();
    await expect(banner('message B')).toHaveCount(0);
    // A is still on offer, with its own id.
    await expect(banner('message A')).toHaveCount(1);
    // B's run ends; the chat takes a new message again (CH-2).
    await runEnded(page);
    await expect(input(page)).toBeEnabled();

    // Sending A again reuses A's id, so the conversation takes it once.
    const before = sent().length;
    await send(page, 'message A');
    await expect.poll(() => sent().length).toBe(before + 1);
    const again = sent()[before];
    expect(again.text).toBe('message A');
    expect(again.id).toBe(sent()[0].id);
    await expect(banner('message A')).toHaveCount(0);
    console.log(
      'CH-4 POSTs:',
      sent()
        .map((p) => `${String(p.text)}:${p.id.slice(0, 4)}`)
        .join(' ')
    );
  });
});
