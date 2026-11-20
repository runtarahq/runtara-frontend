import {
  useState,
  useCallback,
  useEffect,
  useRef,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { Button } from '@/shared/components/ui/button';
import { WaitingForInputData } from '@/features/workflows/types/chat';
import {
  analyzeFormWithRust,
  FormRenderer,
  type FormAnalysisResult,
} from '@/shared/forms';
import {
  initialWorkflowFormValues,
  useWorkflowFormDefinition,
} from '@/features/workflows/utils/form-schema-adapter';
import { useChatStore } from '@/features/workflows/stores/chatStore';
import { Spinner } from '@/shared/components/ui/spinner';
import type { FormDefinition } from '@/shared/forms';
import { RequestCard } from './RequestCard';

interface ChatFormInputProps {
  waitingForInput: WaitingForInputData;
  onSubmit: (
    requestId: string,
    payload: Record<string, unknown>,
    instanceId?: string,
    /** What was answered, in the form's own labels. */
    summary?: string
  ) => Promise<boolean>;
  /** Beside the question: a way out to another request. */
  aside?: ReactNode;
}

/** How many options are still a list of buttons, and not a select. */
const MOST_CHOICES = 6;

/**
 * What a request asks for, by its one field: a go-ahead (yes or no), one of
 * a few options, or, with more fields or another kind, a form.
 */
type Ask =
  | { kind: 'approval'; name: string; yes: string; no: string }
  | {
      kind: 'choice';
      name: string;
      options: { value: unknown; label: string }[];
    }
  | { kind: 'form' };

function askOf(definition: FormDefinition): Ask {
  const fields = Object.entries(definition.fields);
  if (fields.length !== 1) return { kind: 'form' };
  const [name, field] = fields[0];
  if (field.type === 'boolean')
    return /approv|allow|accept|confirm|permi/i.test(name)
      ? { kind: 'approval', name, yes: 'Approve', no: 'Deny' }
      : { kind: 'approval', name, yes: 'Yes', no: 'No' };
  const options =
    field.control?.options ??
    field.enum?.map((value) => ({ value, label: String(value) })) ??
    [];
  if (
    field.type === 'string' &&
    options.length >= 2 &&
    options.length <= MOST_CHOICES
  )
    return { kind: 'choice', name, options };
  return { kind: 'form' };
}

function humanizeKey(value: string): string {
  return value
    .split(/[_-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

export function ChatFormInput({
  waitingForInput,
  onSubmit,
  aside,
}: ChatFormInputProps) {
  const {
    definition,
    loading: formLoading,
    error: formError,
  } = useWorkflowFormDefinition(waitingForInput.responseSchema);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [typedValues, setTypedValues] = useState<Record<string, unknown>>(() =>
    initialWorkflowFormValues(definition)
  );
  const [analysis, setAnalysis] = useState<FormAnalysisResult | null>(null);
  const [submitAttempt, setSubmitAttempt] = useState(0);

  // A number left blank is a number not given: it is no value at all, and
  // is not checked as one.
  const setFormValues = useCallback(
    (values: Record<string, unknown>) =>
      setTypedValues(
        Object.fromEntries(
          Object.entries(values).filter(([name, value]) => {
            const type = definition.fields[name]?.type;
            return !(value === '' && (type === 'number' || type === 'integer'));
          })
        )
      ),
    [definition]
  );
  useEffect(() => {
    setFormValues(initialWorkflowFormValues(definition));
    setAnalysis(null);
  }, [definition, setFormValues]);

  const card = useRef<HTMLElement>(null);
  const ask = askOf(definition);
  const ready = !formLoading && !formError;
  // The card is where the chat goes on: a form's first field has the focus,
  // as the message box had. A go-ahead or a choice is never under the
  // cursor of someone still typing: the card has the focus, not a button.
  useEffect(() => {
    const section = card.current;
    if (!ready || !section) return;
    section.focus({ preventScroll: true });
    if (ask.kind !== 'form') return;
    // The fields are drawn a little after the card is.
    const toFirstField = () => {
      const first = section.querySelector<HTMLElement>(
        'input:not([type=hidden]), textarea, select'
      );
      // Not from someone already at work elsewhere on the page.
      if (first && document.activeElement === section)
        first.focus({ preventScroll: true });
      return !!first;
    };
    if (toFirstField()) return;
    const drawn = new MutationObserver(() => {
      if (toFirstField()) drawn.disconnect();
    });
    drawn.observe(section, { childList: true, subtree: true });
    return () => drawn.disconnect();
  }, [ready, ask.kind]);

  const handleSubmit = useCallback(
    async (answered?: Record<string, unknown>) => {
      const formValues = answered ?? typedValues;
      const submissionAnalysis = await analyzeFormWithRust(
        definition,
        formValues
      );
      setAnalysis(submissionAnalysis);
      setSubmitAttempt((attempt) => attempt + 1);
      if (formLoading || formError || !submissionAnalysis.valid || isSubmitting)
        return;

      // Build payload, coercing types
      const payload: Record<string, unknown> = {};
      for (const [name, field] of Object.entries(definition.fields)) {
        if (submissionAnalysis.fields[name]?.visible === false) continue;
        const val = formValues[name];
        if (field.type === 'number' || field.type === 'integer') {
          payload[name] =
            val !== '' && val !== undefined ? Number(val) : undefined;
        } else if (field.type === 'boolean') {
          payload[name] = Boolean(val);
        } else {
          payload[name] = val;
        }
      }

      // What was answered, for a chat that has no log to read it from.
      const summary = Object.entries(payload)
        .filter(([, val]) => val !== undefined)
        .map(([key, val]) => {
          const field = definition.fields[key];
          const label = field?.label || humanizeKey(key);
          const displayVal =
            typeof val === 'boolean' ? (val ? 'Yes' : 'No') : String(val ?? '');
          return `${label}: ${displayVal}`;
        })
        .join(' | ');

      setIsSubmitting(true);
      try {
        await onSubmit(
          waitingForInput.requestId,
          payload,
          waitingForInput.instanceId,
          summary
        );
      } catch (err: unknown) {
        const message =
          err instanceof Error ? err.message : 'Failed to submit form';
        useChatStore.getState().setError(message);
      } finally {
        setIsSubmitting(false);
      }
    },
    [
      isSubmitting,
      definition,
      typedValues,
      onSubmit,
      waitingForInput.requestId,
      waitingForInput.instanceId,
      formLoading,
      formError,
    ]
  );

  // Enter in a one-line field sends the form, as it sends a message; in a
  // text area it is a new line, and Ctrl or Cmd with it sends from anywhere.
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Enter' || event.nativeEvent.isComposing) return;
    const target = event.target as HTMLElement;
    const oneLine =
      target instanceof HTMLInputElement &&
      ['text', 'number', 'email', 'url', 'tel', 'search'].includes(target.type);
    if (!(event.metaKey || event.ctrlKey) && !oneLine) return;
    event.preventDefault();
    void handleSubmit();
  };

  const field = ask.kind === 'form' ? undefined : definition.fields[ask.name];
  const blocked = !ready || analysis?.wasmAvailable === false || isSubmitting;
  const issues =
    ask.kind !== 'form' && submitAttempt > 0 && analysis && !analysis.valid
      ? 'This answer was not accepted.'
      : null;

  return (
    <RequestCard
      ref={card}
      title={
        waitingForInput.message ||
        field?.label ||
        'The workflow needs an answer'
      }
      source={
        waitingForInput.toolName
          ? `Asked by ${waitingForInput.toolName}`
          : undefined
      }
      aside={aside}
    >
      {formLoading ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Spinner className="size-3.5" />
          Preparing…
        </p>
      ) : formError ? (
        <p className="text-sm text-destructive">{formError}</p>
      ) : ask.kind === 'approval' ? (
        <>
          {field?.description && (
            <p className="mb-3 text-sm text-muted-foreground">
              {field.description}
            </p>
          )}
          <div className="flex items-center justify-end gap-2">
            {isSubmitting && <Spinner className="size-4" />}
            <Button
              variant="secondary"
              size="sm"
              className="rounded-full px-4"
              disabled={blocked}
              onClick={() => void handleSubmit({ [ask.name]: false })}
            >
              {ask.no}
            </Button>
            <Button
              size="sm"
              className="rounded-full px-4"
              disabled={blocked}
              onClick={() => void handleSubmit({ [ask.name]: true })}
            >
              {ask.yes}
            </Button>
          </div>
        </>
      ) : ask.kind === 'choice' ? (
        <>
          {field?.description && (
            <p className="mb-3 text-sm text-muted-foreground">
              {field.description}
            </p>
          )}
          <ul className="space-y-1.5">
            {ask.options.map((option, at) => (
              <li key={String(option.value)}>
                <button
                  type="button"
                  disabled={blocked}
                  onClick={() =>
                    void handleSubmit({ [ask.name]: option.value })
                  }
                  className="flex w-full items-center gap-3 rounded-xl border px-3 py-2 text-left text-sm transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50"
                >
                  <span className="flex size-5 shrink-0 items-center justify-center rounded-md bg-muted text-2xs text-muted-foreground">
                    {at + 1}
                  </span>
                  <span className="min-w-0 flex-1">{option.label}</span>
                </button>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <div onKeyDown={handleKeyDown}>
          <FormRenderer
            definition={definition}
            value={typedValues}
            onChange={setFormValues}
            disabled={isSubmitting}
            onAnalysisChange={setAnalysis}
            submitAttempt={submitAttempt}
          />
          <div className="mt-3 flex items-center justify-end gap-2">
            <Button
              onClick={() => void handleSubmit()}
              disabled={blocked}
              size="sm"
              className="rounded-full px-4"
            >
              {isSubmitting && <Spinner className="mr-2 size-4" />}
              Submit
            </Button>
          </div>
        </div>
      )}
      {issues && <p className="mt-2 text-xs text-destructive">{issues}</p>}
    </RequestCard>
  );
}
