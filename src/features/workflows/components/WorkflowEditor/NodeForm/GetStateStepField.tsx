/** A GetState step has nothing to configure: its form says what it reads. */
export function GetStateStepField() {
  return (
    <p className="text-xs text-muted-foreground">
      Reads the run&apos;s state as of this point:{' '}
      <code>steps.&lt;id&gt;.outputs.&lt;field&gt;</code>. The read is
      checkpointed, so a replay sees what the first execution read.
    </p>
  );
}
