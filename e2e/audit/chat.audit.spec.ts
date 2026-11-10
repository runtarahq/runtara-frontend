import { execSync } from 'node:child_process';
import { expect, type Page } from '@playwright/test';
import { test, buildWorkflow } from '../fixtures';
import type { MockApi } from '../fixtures/mock.fixture';
import { api, json, knownDefect } from './helpers';

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

const SESSION = 'sess_audit';
const INSTANCE = 'inst_audit';

/**
 * A fulfilled route closes its body at once, so the session POST is answered
 * from the page with a stream the test controls. Everything else goes through
 * Playwright routes as usual.
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
      if (
        init?.method === 'POST' &&
        /\/workflows\/[^/]+\/sessions$/.test(url)
      ) {
        window.__sse.opened += 1;
        const body = new ReadableStream<Uint8Array>({
          start(controller) {
            live = controller;
            // A real fetch body errors on abort (StrictMode remounts abort).
            init.signal?.addEventListener('abort', () => {
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

type Submission = { messageId: string; operationId: string; message: string };

async function openChat(page: Page, mockApi: MockApi) {
  const wf = buildWorkflow({ id: 'wf_chat_audit', name: 'Chat audit' });
  const ctl = {
    posts: [] as Submission[],
    /** Status to answer the next message POST with. */
    nextStatus: (() => 200) as (s: Submission) => number,
  };
  await installControlledStream(page);
  await mockApi.bootstrap(page);
  await mockApi.workflows.get(page, wf.id!, wf);
  await page.route(api(`sessions/${SESSION}/pending-input`), (route) =>
    json(route, {
      success: true,
      data: { instanceId: INSTANCE, pendingInputs: [] },
    })
  );
  await page.route(api(`sessions/${SESSION}/deliveries`), (route) =>
    json(route, {
      success: true,
      data: { deliveries: [], nextCursor: '0' },
    })
  );
  await page.route(api(`sessions/${SESSION}/events`), (route) => {
    const s = route.request().postDataJSON() as Submission;
    ctl.posts.push(s);
    const status = ctl.nextStatus(s);
    return status === 200
      ? json(route, {
          success: true,
          data: {
            messageId: s.messageId,
            operationId: s.operationId,
            state: 'queued',
            enqueuedAtMs: Date.now(),
          },
        })
      : json(route, { success: false, message: 'gateway hiccup' }, status);
  });
  await page.goto(`/workflows/${wf.id}/chat`);
  await expect(page.getByRole('heading', { name: 'Chat audit' })).toBeVisible({
    timeout: 15_000,
  });
  await expect
    .poll(() => page.evaluate(() => window.__sse.opened))
    .toBeGreaterThan(0);
  return ctl;
}

const push = (page: Page, event: string, data: Record<string, unknown> = {}) =>
  page.evaluate(
    (text) => window.__sse.push(text),
    `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
  );
const closeStream = (page: Page) => page.evaluate(() => window.__sse.close());
const sessionCreated = (page: Page) =>
  push(page, 'session_created', { session_id: SESSION, instance_id: INSTANCE });

/** The real store, through the dev server's module graph. */
const chatState = (page: Page) =>
  page.evaluate(async () => {
    const path = '/src/features/workflows/stores/chatStore.ts';
    const { useChatStore } = await import(/* @vite-ignore */ path);
    const { status, sessionId, messages } = useChatStore.getState();
    return {
      status: status as string,
      sessionId: sessionId as string | null,
      streaming: (messages as { isStreaming?: boolean }[]).filter(
        (m) => m.isStreaming
      ).length,
    };
  });

const input = (page: Page) => page.getByPlaceholder('Type a message...');
const thinking = (page: Page) => page.getByText('AI is thinking...');
const cursor = (page: Page) => page.locator('span.animate-pulse.w-0\\.5');
const bubble = (page: Page, text: string) =>
  page.locator('p').getByText(text, { exact: true });
const completed = (page: Page) => page.getByText('Completed', { exact: true });

/** Text, then Enter: the way a person sends. */
async function send(page: Page, text: string) {
  await input(page).fill(text);
  await input(page).press('Enter');
}

test.describe('Chat audit', () => {
  test('CH-1 A chat whose stream has ended reaches status done and renders Completed', async ({
    page,
    mockApi,
  }) => {
    const grep = execSync(
      `grep -rnE "setStatus\\(\\s*'done'|status = 'done'|status: 'done'" src --include='*.ts' --include='*.tsx' | grep -v '\\.test\\.' || true`,
      { encoding: 'utf8' }
    ).trim();
    console.log(`CH-1 non-test writes of 'done': ${grep ? grep : 'none'}`);

    await openChat(page, mockApi);
    await sessionCreated(page);
    await push(page, 'message', { content: 'All finished.' });
    await expect(page.getByText('All finished.')).toBeVisible();
    await expect(cursor(page)).toBeVisible();
    await expect(thinking(page)).toBeVisible();

    // The event is received and handled: the cursor and the spinner go.
    await push(page, 'done', { status: 'completed' });
    await expect(cursor(page)).toHaveCount(0);
    await expect(thinking(page)).toHaveCount(0);

    // `done` alone ends a turn in session mode. The stream ending ends the chat.
    await closeStream(page);
    await expect
      .poll(async () => (await chatState(page)).status, { timeout: 2_000 })
      .toBe('done');
    await expect(completed(page)).toBeVisible();
  });

  test('CH-2 After a send, the chat is not idle while the stream is open and chunks arrive', async ({
    page,
    mockApi,
  }) => {
    const ctl = await openChat(page, mockApi);
    await sessionCreated(page);
    await push(page, 'message', { content: 'Hello, how can I help?' });
    await expect(page.getByText('Hello, how can I help?')).toBeVisible();
    expect((await chatState(page)).sessionId).toBe(SESSION);

    // While status is streaming the input refuses text, so a send starts from
    // `idle` or `error`, not from `streaming`.
    expect((await chatState(page)).status).toBe('streaming');
    await expect(input(page)).toBeDisabled();

    await push(page, 'done');
    await expect(input(page)).toBeEnabled();

    await send(page, 'first question');
    await expect.poll(() => ctl.posts.length).toBe(1);
    await expect(bubble(page, 'first question')).toBeVisible();

    expect(await page.evaluate(() => window.__sse.closed)).toBe(0);

    await push(page, 'llm_start');
    await push(page, 'message', { content: 'Working on it' });
    await expect(page.getByText('Working on it')).toBeVisible();
    await expect(cursor(page)).toBeVisible();
    // Stream open, a reply arriving: what the page calls this.
    const whileReplying = (await chatState(page)).status;
    await push(page, 'done');

    // The write itself: a send from `error`, with the stream still open.
    await push(page, 'error', { message: 'turn failed' });
    await expect.poll(async () => (await chatState(page)).status).toBe('error');
    await send(page, 'second question');
    await expect.poll(() => ctl.posts.length).toBe(2);
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

  test('CH-3 If the stream closes without done after a send, the streaming cursor clears', async ({
    page,
    mockApi,
  }) => {
    await openChat(page, mockApi);
    // Control: closing without `done` while status is streaming finalizes.
    await sessionCreated(page);
    await push(page, 'message', { content: 'control reply' });
    await expect(page.getByText('control reply')).toBeVisible();
    await expect(cursor(page)).toBeVisible();
    await closeStream(page);
    await expect(cursor(page)).toHaveCount(0);

    // Now the claimed path: a send first, then the same close.
    await page.reload();
    await expect
      .poll(() => page.evaluate(() => window.__sse.opened))
      .toBeGreaterThan(0);
    await sessionCreated(page);
    await push(page, 'message', { content: 'greeting' });
    await push(page, 'done');
    await expect(input(page)).toBeEnabled();
    await send(page, 'a question');
    await expect(bubble(page, 'a question')).toBeVisible();
    await push(page, 'message', { content: 'partial answer' });
    await expect(page.getByText('partial answer')).toBeVisible();
    await expect(cursor(page)).toBeVisible();

    await closeStream(page);
    expect(await page.evaluate(() => window.__sse.closed)).toBe(1);
    // Fixed: a stream that ends early stops the reply's cursor.
    await expect(cursor(page)).toHaveCount(0, { timeout: 5_000 });
    expect((await chatState(page)).streaming).toBe(0);
    expect((await chatState(page)).status).toBe('idle');
  });

  test('CH-4 A new send keeps the earlier unconfirmed message on offer for retry', async ({
    page,
    mockApi,
  }) => {
    const ctl = await openChat(page, mockApi);
    await sessionCreated(page);
    await push(page, 'done');
    await expect(input(page)).toBeEnabled();
    const banner = (text: string) =>
      page.getByText(`Message receipt is unconfirmed: ${text}`);
    const retry = page.getByRole('button', { name: 'Retry this message' });

    // A: the acknowledgement is lost.
    ctl.nextStatus = () => 502;
    await send(page, 'message A');
    await expect(banner('message A')).toBeVisible();

    // Control: retrying A keeps its identity, so the server can dedupe.
    await retry.click();
    await expect.poll(() => ctl.posts.length).toBe(2);
    expect(ctl.posts[1].messageId).toBe(ctl.posts[0].messageId);
    expect(ctl.posts[1].operationId).toBe(ctl.posts[0].operationId);
    // Let the retry settle: a send during it is ignored by the enqueue guard.
    await page.waitForTimeout(300);

    // B fails too: A must still be on offer.
    await send(page, 'message B');
    await expect(banner('message B')).toBeVisible();
    await knownDefect('CH-4', async () => {
      await expect(banner('message A')).toHaveCount(1);
    });

    // B goes through.
    ctl.nextStatus = () => 200;
    await retry.click();
    await expect(bubble(page, 'message B')).toBeVisible();
    await expect(banner('message B')).toHaveCount(0);
    // B's reply ends; the chat takes a new message again (CH-2).
    await push(page, 'done');
    await expect(input(page)).toBeEnabled();

    // Typing A again is a new message, which the server cannot match to the
    // first attempt.
    const before = ctl.posts.length;
    await send(page, 'message A');
    await expect.poll(() => ctl.posts.length).toBe(before + 1);
    const again = ctl.posts[before];
    expect(again.message).toBe('message A');
    expect(again.messageId).not.toBe(ctl.posts[0].messageId);
    expect(again.operationId).not.toBe(ctl.posts[0].operationId);
    console.log(
      'CH-4 POSTs:',
      ctl.posts.map((p) => `${p.message}:${p.messageId.slice(0, 4)}`).join(' ')
    );
  });
});
