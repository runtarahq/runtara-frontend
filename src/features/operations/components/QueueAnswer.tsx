import { stateLabel } from '../state-label';
import { inlineOptions, isNegativeAnswer } from '../answer-options';
import { Link } from 'react-router';
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { OperationRequest } from '@/generated/RuntaraRuntimeApi';
import { Button } from '@/shared/components/ui/button';
import {
  FormRenderer,
  analyzeFormWithRust,
  type FormAnalysisResult,
} from '@/shared/forms';
import {
  useWorkflowFormDefinition,
  initialWorkflowFormValues,
  workflowFormPayload,
} from '@/features/workflows/utils/form-schema-adapter';
import { useManagedInputSubmissions } from '@/features/workflows/hooks/useManagedInputSubmissions';

/** How long a one-click answer can be taken back before it is sent. */
export const UNDO_MS = 5000;

export interface AnswerController {
  /** Answers at once: the caller has already confirmed (a bulk answer). */
  choose(value: unknown): Promise<void>;
  /** Sends the row's open form; false when the row has none to send. */
  submit(): Promise<boolean>;
}
export const QueueAnswer = forwardRef<
  AnswerController,
  { row: OperationRequest; inline?: string | null; infer?: boolean }
>(function QueueAnswer({ row, inline, infer }, ref) {
  const { definition, loading, error } = useWorkflowFormDefinition(
    row.inputSchema
  );
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [editing, setEditing] = useState(false);
  const choosingRef = useRef(false);
  // A one-click answer waits here, where Undo can still drop it.
  const [pending, setPending] = useState<{
    value: unknown;
    payload: Record<string, unknown>;
  } | null>(null);
  const pendingRef = useRef<{
    payload: Record<string, unknown>;
    timer: ReturnType<typeof setTimeout>;
  } | null>(null);
  const [analysis, setAnalysis] = useState<FormAnalysisResult | null>(null);
  const [attempt, setAttempt] = useState(0);
  const submissions = useManagedInputSubmissions();
  const retained = [...submissions.inputs]
    .reverse()
    .find(
      (input) =>
        input.request.instanceId === row.instanceId &&
        input.request.requestId === row.requestId
    );
  const disabled = Boolean(retained) || loading || Boolean(error);
  const options = inlineOptions(row.inputSchema, inline, infer);
  const current = useMemo(
    () => ({ ...initialWorkflowFormValues(definition), ...values }),
    [definition, values]
  );
  async function send(payload: Record<string, unknown>) {
    if (disabled) return;
    payload = workflowFormPayload(definition, payload);
    const result = await analyzeFormWithRust(definition, payload);
    setAnalysis(result);
    setAttempt((n) => n + 1);
    if (!result.valid) {
      setEditing(true);
      return;
    }
    const visible = Object.fromEntries(
      Object.keys(definition.fields)
        .filter((name) => result.fields[name]?.visible !== false)
        .map((name) => [name, payload[name]])
    );
    await submissions.submit(
      {
        kind: 'execution',
        workflowId: row.workflowId,
        instanceId: row.instanceId,
        requestId: row.requestId,
        payload: visible,
      },
      row.runLabel ?? row.label
    );
  }
  function undo() {
    if (pendingRef.current) clearTimeout(pendingRef.current.timer);
    pendingRef.current = null;
    setPending(null);
    setValues({});
    setAnalysis(null);
  }
  const sendRef = useRef(send);
  sendRef.current = send;
  // Leaving the list before the delay is over still sends what was chosen:
  // the choice was made, only its undo window is cut short.
  useEffect(
    () => () => {
      const waiting = pendingRef.current;
      if (!waiting) return;
      clearTimeout(waiting.timer);
      pendingRef.current = null;
      void sendRef.current(waiting.payload);
    },
    []
  );
  async function choose(value: unknown, undoable = false) {
    if (
      disabled ||
      pendingRef.current ||
      choosingRef.current ||
      !options ||
      !options.values.some((v) => JSON.stringify(v) === JSON.stringify(value))
    )
      return;
    // One choice at a time: a second click during the analysis used to send
    // a second answer (OP-4).
    choosingRef.current = true;
    try {
      const payload = workflowFormPayload(definition, {
        ...current,
        [options.field]: value,
      });
      setValues(payload);
      const result = await analyzeFormWithRust(definition, payload);
      setAnalysis(result);
      const extra = Object.keys(definition.fields).some(
        (name) =>
          name !== options.field &&
          result.fields[name]?.visible !== false &&
          result.fields[name]?.required
      );
      if (extra || !result.valid) {
        setEditing(true);
        return;
      }
      if (!undoable) {
        await send(payload);
        return;
      }
      pendingRef.current = {
        payload,
        timer: setTimeout(() => {
          pendingRef.current = null;
          setPending(null);
          void sendRef.current(payload);
        }, UNDO_MS),
      };
      setPending({ value, payload });
    } finally {
      choosingRef.current = false;
    }
  }
  // Leaving the editor drops the draft, so the row returns to its options (OP-3).
  function cancel() {
    setEditing(false);
    setValues({});
    setAnalysis(null);
  }
  useImperativeHandle(ref, () => ({
    choose: (value: unknown) => choose(value),
    submit: async () => {
      if (!editing || disabled) return false;
      await send(current);
      return true;
    },
  }));
  if (!infer && !inline)
    return (
      <Link
        className="text-primary-text"
        to={`/operations/requests?request=${encodeURIComponent(`${row.instanceId}/${row.requestId}`)}`}
      >
        Answer
      </Link>
    );
  if (retained)
    return (
      <div role="status" className="max-w-xs text-sm">
        {retained.state === 'accepted'
          ? 'Answered'
          : retained.state === 'submitting'
            ? 'Sending…'
            : retained.state === 'uncertain'
              ? 'Not confirmed — retry below'
              : `Could not answer: ${retained.error ?? 'request is no longer open'}`}
      </div>
    );
  if (pending)
    return (
      <div role="status" className="flex max-w-xs items-center gap-2 text-sm">
        <span className="min-w-0 truncate">
          Sending “{stateLabel(String(pending.value))}”…
        </span>
        <Button size="sm" variant="secondary" bordered onClick={undo}>
          Undo
        </Button>
      </div>
    );
  if (error) return <p role="alert">{error}</p>;
  if (loading) return <p>Preparing answer…</p>;
  return (
    <div className="min-w-40 space-y-3">
      {!editing && options ? (
        <div className="flex flex-wrap gap-2">
          {options.values.map((value, index) => {
            const negative = isNegativeAnswer(value);
            // The accepting choice leads; the one that turns down reads apart.
            const primary =
              !negative &&
              index === options.values.findIndex((v) => !isNegativeAnswer(v)) &&
              options.values.some(isNegativeAnswer);
            return (
              <Button
                key={JSON.stringify(value)}
                size="sm"
                variant={
                  primary
                    ? 'primary'
                    : negative
                      ? 'secondaryDestructive'
                      : 'secondary'
                }
                bordered={!primary}
                disabled={disabled}
                onClick={() => void choose(value, true)}
              >
                {stateLabel(String(value))}
              </Button>
            );
          })}
        </div>
      ) : null}
      {!editing && !options ? (
        <Button
          variant="secondary"
          bordered
          size="sm"
          onClick={() => {
            setValues(current);
            setEditing(true);
          }}
        >
          Answer
        </Button>
      ) : null}
      {editing ? (
        <div
          className="space-y-3 rounded border bg-background p-3"
          onKeyDown={(event) => {
            if (event.key === 'Escape') cancel();
          }}
        >
          <FormRenderer
            definition={definition}
            value={current}
            onChange={setValues}
            onAnalysisChange={setAnalysis}
            submitAttempt={attempt}
            disabled={disabled}
          />
          <Button
            size="sm"
            disabled={disabled || analysis?.wasmAvailable === false}
            onClick={() => void send(current)}
          >
            Send answer
          </Button>
          <Button size="sm" variant="secondary" bordered onClick={cancel}>
            Cancel
          </Button>
        </div>
      ) : null}
    </div>
  );
});
