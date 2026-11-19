import { Button } from '@/shared/components/ui/button';
import { stateLabel } from '@/features/runs/utils/state-label';

/** Answering the selected requests together. */
export function QueueBulkBar({
  count,
  common,
  onChoose,
  onSubmit,
  onClear,
}: {
  count: number;
  /** The answers every selected request accepts. */
  common: unknown[];
  onChoose: (value: unknown) => void;
  onSubmit: () => void;
  onClear: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3 border-b bg-primary/5 px-4 py-3 text-sm">
      <strong>{count} requests selected</strong>
      {common.map((value) => (
        <Button
          size="sm"
          key={JSON.stringify(value)}
          onClick={() => onChoose(value)}
        >
          {stateLabel(String(value))} selected
        </Button>
      ))}
      <Button size="sm" variant="secondary" bordered onClick={onSubmit}>
        Submit prepared answers
      </Button>
      <Button size="sm" variant="secondary" bordered onClick={onClear}>
        Clear
      </Button>
      <p className="basis-full text-muted-foreground">
        Additional fields appear in each row. Review them before submitting.
      </p>
    </div>
  );
}
