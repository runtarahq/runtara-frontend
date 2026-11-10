/**
 * Whether the open step editor's step is gone from the canvas, so the editor
 * should close. Without this, deleting the edited step hid the panel but left
 * it "open", and a later single click opened it again (ED-2). A step that was
 * just renamed is not gone: the editor follows it to its new id.
 */
export function editorLostItsStep(
  editingNodeId: string | null,
  nodeIds: readonly string[],
  lastRename: { oldId: string; newId: string } | null
): boolean {
  if (!editingNodeId || nodeIds.includes(editingNodeId)) return false;
  return lastRename?.oldId !== editingNodeId;
}
