import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { addDays } from 'date-fns';
import { Copy, Check, AlertTriangle } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/components/ui/dialog';
import { Button } from '@/shared/components/ui/button';
import { Checkbox } from '@/shared/components/ui/checkbox';
import { Input } from '@/shared/components/ui/input';
import { Label } from '@/shared/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/shared/components/ui/select';
import { FieldError } from '@/shared/components/ui/form';
import { useCreateApiKey } from '../../hooks/useApiKeys';
import { Alert, AlertDescription } from '@/shared/components/ui/alert';
import type { ApiKeyScope } from '@/generated/RuntaraRuntimeApi';

/**
 * Expiry presets, shortest first. `null` days is "no expiration" — kept as an option in the
 * same select rather than a separate checkbox, so choosing a permanent key is one decision in
 * one control instead of two that can disagree.
 *
 * The default is a bounded lifetime, not "never": before this existed every key created through
 * this dialog was permanent, and a default that quietly reproduces that is the thing worth
 * changing. A permanent key is still one click away, it just has to be asked for.
 */
const EXPIRY_OPTIONS = [
  { value: '30d', label: '30 days', days: 30 },
  { value: '90d', label: '90 days', days: 90 },
  { value: '180d', label: '180 days', days: 180 },
  { value: '1y', label: '1 year', days: 365 },
  { value: 'never', label: 'No expiration', days: null },
] as const;

const DEFAULT_EXPIRY = '90d';

type ExpiryValue = (typeof EXPIRY_OPTIONS)[number]['value'];

/** The `expires_at` a preset resolves to, or `undefined` for "no expiration". */
function expiresAtFor(value: ExpiryValue): string | undefined {
  const option = EXPIRY_OPTIONS.find((o) => o.value === value);
  if (!option?.days) return undefined;
  return addDays(new Date(), option.days).toISOString();
}

/**
 * The grantable permissions, grouped for the custom-scope picker. Mirrors the backend permission
 * vocabulary (`authz::Permission`). `user_management:access` (UI-only, never grantable to a key)
 * and `workflow:folder_rename` (owner/admin-only, niche) are intentionally omitted. The server
 * clamps a request to the creator's own permissions, so asking for more than you hold is a 403.
 */
const PERMISSION_GROUPS = [
  {
    label: 'Workflows',
    permissions: [
      { id: 'workflow:read', label: 'Read' },
      { id: 'workflow:create', label: 'Create' },
      { id: 'workflow:update', label: 'Update' },
      { id: 'workflow:delete', label: 'Delete' },
      { id: 'workflow:execute', label: 'Run' },
    ],
  },
  {
    label: 'Connections',
    permissions: [
      { id: 'connection:read', label: 'Read' },
      { id: 'connection:create', label: 'Create' },
      { id: 'connection:update', label: 'Update' },
      { id: 'connection:delete', label: 'Delete' },
    ],
  },
  {
    label: 'Database',
    permissions: [
      { id: 'database:read', label: 'Read' },
      { id: 'database:create', label: 'Create' },
      { id: 'database:update', label: 'Update' },
      { id: 'database:delete', label: 'Delete' },
    ],
  },
  {
    label: 'Triggers',
    permissions: [
      { id: 'trigger:read', label: 'Read' },
      { id: 'trigger:create', label: 'Create' },
      { id: 'trigger:update', label: 'Update' },
      { id: 'trigger:delete', label: 'Delete' },
    ],
  },
  {
    label: 'Observability',
    permissions: [
      { id: 'invocation_history:read', label: 'Execution history' },
      { id: 'analytics:read', label: 'Analytics' },
    ],
  },
] as const;

const SCOPE_MODES = [
  { value: 'full', label: 'Full access (acts as you)' },
  { value: 'read_only', label: 'Read-only' },
  { value: 'custom', label: 'Custom — choose permissions' },
] as const;

type ScopeMode = (typeof SCOPE_MODES)[number]['value'];

/**
 * Resolve the form's scope selection to the request's `scope` field. `full` sends nothing (an
 * unscoped key is stored identically to every key created before scopes existed); `read_only`
 * sends the preset; `custom` sends the chosen permission array.
 */
function scopeFor(
  mode: ScopeMode,
  permissions: string[]
): ApiKeyScope | undefined {
  switch (mode) {
    case 'full':
      return undefined;
    case 'read_only':
      return 'read_only';
    case 'custom':
      // The checkbox ids come from PERMISSION_GROUPS — all valid permission wire-names in the
      // generated `ApiKeyScope` union — but the form holds them as a plain `string[]`, so narrow
      // here. The backend is the real validator: it rejects unknown names and clamps to the
      // creator's own permissions.
      return permissions as ApiKeyScope;
  }
}

const schema = z
  .object({
    name: z.string().min(1, 'Name is required').max(100, 'Name is too long'),
    scopeMode: z.enum(['full', 'read_only', 'custom']),
    permissions: z.array(z.string()),
    expiry: z.enum(EXPIRY_OPTIONS.map((o) => o.value) as [string, ...string[]]),
  })
  .refine((d) => d.scopeMode !== 'custom' || d.permissions.length > 0, {
    message: 'Select at least one permission',
    path: ['permissions'],
  });

type FormValues = z.infer<typeof schema>;

interface CreateApiKeyDialogProps {
  open: boolean;
  onClose: () => void;
}

export function CreateApiKeyDialog({ open, onClose }: CreateApiKeyDialogProps) {
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const { mutate: createKey, isPending } = useCreateApiKey();

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: '',
      scopeMode: 'full',
      permissions: [],
      expiry: DEFAULT_EXPIRY,
    },
  });

  const scopeMode = form.watch('scopeMode') as ScopeMode;

  const handleSubmit = ({
    name,
    scopeMode,
    permissions,
    expiry,
  }: FormValues) => {
    // Omitted scope / expiry are sent as absent rather than an explicit "none": an unscoped,
    // non-expiring key is then stored exactly like every key created before either control
    // existed, so there is one representation of each default.
    const expiresAt = expiresAtFor(expiry as ExpiryValue);
    const scope = scopeFor(scopeMode as ScopeMode, permissions);
    createKey(
      {
        name,
        ...(scope !== undefined ? { scope } : {}),
        ...(expiresAt ? { expires_at: expiresAt } : {}),
      },
      {
        onSuccess: (data) => {
          setCreatedKey(data.key);
          toast.success('API key created');
        },
      }
    );
  };

  const handleCopy = async () => {
    if (!createdKey) return;
    // A refused clipboard was an unhandled rejection and no message (ST-3).
    try {
      await navigator.clipboard.writeText(createdKey);
    } catch {
      toast.error('Could not copy the key. Select it and copy it yourself.');
      return;
    }
    setCopied(true);
    toast.success('Copied to clipboard');
    setTimeout(() => setCopied(false), 2000);
  };

  const handleClose = () => {
    setCreatedKey(null);
    setCopied(false);
    form.reset();
    onClose();
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        // Closing while the key is being created hid it when it arrived: the
        // toast said created, and the only copy of the key went unseen
        // (ST-1). The dialog stays until the answer is in.
        if (!next && isPending) return;
        // The reveal view holds the only copy of the key: Esc or a click
        // outside destroyed it unasked. Only Done closes it (ST-2).
        if (!next && createdKey) return;
        handleClose();
      }}
    >
      <DialogContent hideCloseButton={Boolean(createdKey)}>
        {createdKey ? (
          <>
            <DialogHeader>
              <DialogTitle>API Key Created</DialogTitle>
              <DialogDescription>
                Copy your API key now. You won't be able to see it again.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <Alert variant="warning">
                <AlertTriangle className="size-4" />
                <AlertDescription>
                  This is the only time the full key will be displayed. Store it
                  securely.
                </AlertDescription>
              </Alert>
              <div className="flex items-center gap-2">
                <code className="flex-1 break-all rounded-md bg-muted px-3 py-2 font-mono text-sm">
                  {createdKey}
                </code>
                <Button
                  variant="secondary"
                  bordered
                  size="icon"
                  onClick={handleCopy}
                  className="shrink-0"
                >
                  {copied ? (
                    <Check className="size-4" />
                  ) : (
                    <Copy className="size-4" />
                  )}
                </Button>
              </div>
            </div>
            <DialogFooter>
              <Button onClick={handleClose}>Done</Button>
            </DialogFooter>
          </>
        ) : (
          <form onSubmit={form.handleSubmit(handleSubmit)}>
            <DialogHeader>
              <DialogTitle>Create API Key</DialogTitle>
              <DialogDescription>
                Create an API key for MCP or external integrations.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div>
                <Label htmlFor="name">Name</Label>
                <Input
                  id="name"
                  placeholder="e.g. MCP Server, CI/CD Pipeline"
                  {...form.register('name')}
                  className="mt-1.5"
                />
                {form.formState.errors.name && (
                  <FieldError className="mt-1">
                    {form.formState.errors.name.message}
                  </FieldError>
                )}
              </div>
              <div>
                <Label htmlFor="expiry">Expiration</Label>
                <Controller
                  control={form.control}
                  name="expiry"
                  render={({ field }) => (
                    <Select value={field.value} onValueChange={field.onChange}>
                      <SelectTrigger id="expiry" className="mt-1.5">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {EXPIRY_OPTIONS.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                />
              </div>
              <div>
                <Label htmlFor="scope-mode">Access</Label>
                <Controller
                  control={form.control}
                  name="scopeMode"
                  render={({ field }) => (
                    <Select value={field.value} onValueChange={field.onChange}>
                      <SelectTrigger id="scope-mode" className="mt-1.5">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {SCOPE_MODES.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                />
                <p className="mt-1.5 text-xs text-muted-foreground">
                  The key always acts as you — it can never exceed your own
                  permissions, and these also gate which MCP tools it can use.
                  Scope can't be changed later.
                </p>
              </div>
              {scopeMode === 'custom' && (
                <Controller
                  control={form.control}
                  name="permissions"
                  render={({ field }) => (
                    <div className="space-y-3 rounded-md border border-border p-3">
                      {PERMISSION_GROUPS.map((group) => (
                        <div key={group.label}>
                          <p className="mb-1.5 text-xs font-medium text-muted-foreground">
                            {group.label}
                          </p>
                          <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
                            {group.permissions.map((perm) => (
                              <label
                                key={perm.id}
                                htmlFor={perm.id}
                                className="flex items-center gap-2 text-sm font-normal"
                              >
                                <Checkbox
                                  id={perm.id}
                                  checked={field.value.includes(perm.id)}
                                  onCheckedChange={(state) => {
                                    const next =
                                      state === true
                                        ? [...field.value, perm.id]
                                        : field.value.filter(
                                            (p) => p !== perm.id
                                          );
                                    field.onChange(next);
                                  }}
                                />
                                {perm.label}
                              </label>
                            ))}
                          </div>
                        </div>
                      ))}
                      {form.formState.errors.permissions && (
                        <FieldError>
                          {form.formState.errors.permissions.message}
                        </FieldError>
                      )}
                    </div>
                  )}
                />
              )}
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="secondary"
                onClick={handleClose}
                disabled={isPending}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={isPending}>
                {isPending ? 'Creating...' : 'Create'}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
