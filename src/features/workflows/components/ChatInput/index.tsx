import {
  useState,
  useEffect,
  useLayoutEffect,
  useCallback,
  useRef,
  KeyboardEvent,
} from 'react';
import { ArrowUp, Square } from 'lucide-react';
import { Button } from '@/shared/components/ui/button.tsx';
import { Textarea } from '@/shared/components/ui/textarea.tsx';
import {
  ChatStatus,
  WaitingForInputData,
} from '@/features/workflows/types/chat';
import { ChatFormInput } from './ChatFormInput';

interface ChatInputProps {
  onSend: (message: string) => Promise<boolean>;
  onSignalResponse?: (response: string) => Promise<boolean>;
  /** Stops the run the chat is busy with. Offered where the send button is
   * while a run is busy and nothing is typed. */
  onStop?: () => void;
  status: ChatStatus;
  waitingForInput: WaitingForInputData | null;
  pendingInputs: WaitingForInputData[];
  onSelectInput: (input: WaitingForInputData | null) => void;
  onSubmitInput: (
    requestId: string,
    payload: Record<string, unknown>,
    instanceId?: string,
    summary?: string
  ) => Promise<boolean>;
}

/** How tall the box grows with what is typed before it scrolls. */
const MAX_HEIGHT = 200;

export function ChatInput({
  onSend,
  onSignalResponse,
  onStop,
  status,
  waitingForInput,
  pendingInputs,
  onSelectInput,
  onSubmitInput,
}: ChatInputProps) {
  const [value, setValue] = useState('');
  const sendingRef = useRef(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // The request that was open when the draft was last typed in, if one was.
  const draftFor = useRef<string | null>(null);

  const requestKey = waitingForInput
    ? JSON.stringify([waitingForInput.instanceId, waitingForInput.requestId])
    : null;
  useEffect(() => {
    // A reply typed for one request must not become a draft response to the
    // next. What was typed while nothing was asked (the run was busy) is the
    // next message, and is kept: a chat is typed ahead in.
    if (requestKey && draftFor.current && draftFor.current !== requestKey)
      setValue('');
    draftFor.current = null;
  }, [requestKey]);

  // The box is where a chat is typed: it has the focus when the chat opens,
  // and takes it back when a request for plain text arrives, unless the
  // person is at work somewhere else on the page.
  useEffect(() => {
    const active = document.activeElement;
    if (!active || active === document.body) textareaRef.current?.focus();
  }, [requestKey]);

  // As tall as what is typed, up to a point; back down when it is sent.
  useLayoutEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = 'auto';
    textarea.style.height = `${Math.min(textarea.scrollHeight, MAX_HEIGHT)}px`;
  }, [value]);

  // A message may be sent at any time: one sent while the run is busy waits
  // its turn in the conversation.
  const isBusy = status === 'streaming' && !waitingForInput;
  const isWaiting = status === 'waiting_for_input';
  const canSend = value.trim().length > 0;

  // Detect whether the response schema is a simple conversational input
  // (no schema, empty schema, or a single "message" field).
  // In that case, suppress all "input required" hints for a conversational look.
  const isSimpleMessageSchema = (() => {
    const schema = waitingForInput?.responseSchema;
    if (!schema || typeof schema !== 'object') return true;
    const keys = Object.keys(schema);
    return keys.length === 0 || (keys.length === 1 && keys[0] === 'message');
  })();

  // Only show schema hints when the response schema requires structured input.
  const schemaFieldDescription = (() => {
    if (isSimpleMessageSchema) return undefined;
    const schema = waitingForInput?.responseSchema;
    if (!schema || typeof schema !== 'object') return undefined;
    const fieldEntries = Object.entries(schema);
    if (fieldEntries.length !== 1) return undefined;
    const [, fieldDef] = fieldEntries[0];
    const def = fieldDef as Record<string, unknown> | undefined;
    return typeof def?.description === 'string' && def.description
      ? def.description
      : undefined;
  })();

  const handleSend = useCallback(async () => {
    const text = value.trim();
    if (!text || sendingRef.current) return;
    sendingRef.current = true;
    // Gone from the box at once, and the box is never disabled, so the
    // focus stays and the next message can be typed while this one is
    // sent. If it is not taken, it is put back, unless more was typed.
    setValue('');
    draftFor.current = null;
    try {
      const accepted = await (isWaiting && onSignalResponse
        ? onSignalResponse(text)
        : onSend(text));
      if (!accepted) setValue((typed) => typed || text);
    } catch {
      setValue((typed) => typed || text);
    } finally {
      sendingRef.current = false;
    }
  }, [value, isWaiting, onSend, onSignalResponse]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      // Enter sends and Shift+Enter is a new line. Enter that ends a word
      // being composed (an input method's) is not the message's.
      if (e.key !== 'Enter' || e.shiftKey || e.nativeEvent.isComposing) return;
      e.preventDefault();
      void handleSend();
    },
    [handleSend]
  );

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      setValue(e.target.value);
      draftFor.current = e.target.value ? requestKey : null;
    },
    [requestKey]
  );

  if (pendingInputs.length > 1 && !waitingForInput) {
    return (
      <div className="space-y-2 border-t p-4">
        <p className="text-sm">Choose which request to answer</p>
        {pendingInputs.map((input) => (
          <Button
            key={JSON.stringify([input.instanceId, input.requestId])}
            variant="secondary"
            onClick={() => onSelectInput(input)}
          >
            {input.message || input.toolName || input.requestId}
          </Button>
        ))}
      </div>
    );
  }
  const chooser =
    pendingInputs.length > 1 ? (
      <Button variant="secondary" onClick={() => onSelectInput(null)}>
        Choose another request
      </Button>
    ) : null;
  if (isWaiting && !isSimpleMessageSchema && waitingForInput) {
    return (
      <div>
        {chooser}
        <ChatFormInput
          key={JSON.stringify([
            waitingForInput.instanceId,
            waitingForInput.requestId,
          ])}
          waitingForInput={waitingForInput}
          onSubmit={onSubmitInput}
        />
      </div>
    );
  }

  // While a run is busy and nothing is typed, the button stops it, as a
  // chat's does; with something typed it sends, and the message waits. A
  // run that only waits for the next message is not busy: there the button
  // is the one that sends.
  const offersStop = !!onStop && !canSend && isBusy;

  return (
    <div className="bg-background px-4 pb-3 pt-2">
      <div className="mx-auto w-full max-w-3xl">
        {chooser}
        {isWaiting &&
          !isSimpleMessageSchema &&
          (waitingForInput?.message || schemaFieldDescription) && (
            <div className="mb-2 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
              {waitingForInput?.message || schemaFieldDescription}
            </div>
          )}

        <div
          className="flex cursor-text items-end gap-2 rounded-2xl border bg-background py-2 pl-4 pr-2 shadow-sm transition-shadow focus-within:border-ring focus-within:ring-1 focus-within:ring-ring"
          onClick={() => textareaRef.current?.focus()}
        >
          <Textarea
            ref={textareaRef}
            value={value}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            placeholder={schemaFieldDescription || 'Type a message...'}
            aria-label="Message"
            className="min-h-[24px] flex-1 resize-none border-0 bg-transparent p-0 py-1.5 shadow-none focus-visible:ring-0 focus-visible:ring-offset-0"
            rows={1}
          />
          {offersStop ? (
            <Button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onStop?.();
              }}
              size="icon"
              className="size-9 shrink-0 rounded-full"
              aria-label="Stop"
            >
              <Square className="size-3.5 fill-current" />
            </Button>
          ) : (
            <Button
              type="button"
              // The box keeps the focus: pressing the button is not leaving it.
              onMouseDown={(event) => event.preventDefault()}
              onClick={(event) => {
                event.stopPropagation();
                void handleSend();
              }}
              disabled={!canSend}
              size="icon"
              className="size-9 shrink-0 rounded-full"
              aria-label="Send"
            >
              <ArrowUp className="size-4" />
            </Button>
          )}
        </div>
        <p className="mt-1.5 px-1 text-center text-3xs text-muted-foreground">
          {isBusy
            ? 'Working. A message sent now waits its turn.'
            : 'Enter to send, Shift+Enter for a new line'}
        </p>
      </div>
    </div>
  );
}
