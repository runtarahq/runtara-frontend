import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useForm, useWatch, type FieldErrors } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';

import type {
  ConnectionGrantState,
  ConnectionStatus,
  ConnectionTypeDto,
  RateLimitConfigDto,
  RateLimitStatusDto,
} from '@/generated/RuntaraRuntimeApi';
import { NextForm } from '@/shared/components/NextForm';
import { reportFirstFormError } from '@/shared/components/NextForm/form-errors';
import { ServiceIcon } from '@/shared/components/service-icon';
import { useNavigationBlockerStore } from '@/shared/stores/navigationBlockerStore';
import {
  analyzeFormWithRust,
  FormRenderer,
  type FormAnalysisResult,
} from '@/shared/forms';

import { ConnectionPageShell } from '../ConnectionPageShell';
import { ConnectionSaveBar } from '../ConnectionSaveBar';
import { CollapsedSection } from '../CollapsedSection';
import { DangerZoneSection } from '../DangerZoneSection';
import { ConnectionStatusCard } from '../../ConnectionStatusCard';
import { DeleteConnectionDialog } from '../../DeleteConnectionDialog';
import { patchStripsAuthorization } from '../../../utils/reauthorization';
import {
  managedAppsOf,
  onPlatformApp,
  platformAppOf,
  withoutPlatformAppCredentials,
} from '../../../utils/platformApps';
import { PlatformAppChoice, PlatformAppNotice } from './PlatformAppChoice';
import { DefaultForSection } from '../DefaultForSection';
import { RateLimitSection } from '../RateLimitSection';
import {
  buildConnectionFormDefinition,
  buildConnectionCreateParameters,
  buildConnectionParameterValues,
  type ConnectionTypeWithForm,
  type EditProjection,
} from './adapter';
import { ConnectionFieldFrame } from './ConnectionFieldFrame';

const EMPTY_SECRET_STATE: NonNullable<EditProjection['secretState']> = {};

type DynamicConnectionFormProps = {
  connectionType: ConnectionTypeDto;
  initValues?: Record<string, unknown>;
  isLoading?: boolean;
  onSubmit: (
    data: Record<string, unknown>,
    operations: ConnectionFormOperations
  ) => void;
  mode?: 'create' | 'edit';
  onDelete?: () => void;
  isDeleting?: boolean;
  rateLimitStatus?: RateLimitStatusDto | null;
  showReconnect?: boolean;
  onReconnect?: () => void;
  isReconnecting?: boolean;
  needsReconnect?: boolean;
  conflictNotice?: ReactNode;
  reconnectNotice?: ReactNode;
  /** Create mode, interactive-OAuth type: hints the post-create authorize step. */
  oauthCreateHint?: boolean;
};

export interface ConnectionFormOperations {
  clearSecrets: string[];
  dirtyFields: string[];
  /** The user asked for "Save & Reconnect": reconnect once the save lands. */
  reconnect?: boolean;
}

const frameSchema = z
  .object({
    title: z.string().min(1, 'Please enter a title'),
    rateLimitEnabled: z.boolean(),
    requestsPerSecond: z.coerce.number().min(0).optional(),
    burstSize: z.coerce.number().min(0).optional(),
    maxRetries: z.coerce.number().min(0).optional(),
    maxWaitMs: z.coerce.number().min(0).optional(),
    retryOnLimit: z.boolean(),
    defaultFor: z.array(z.string()).optional(),
    isDefaultFileStorage: z.boolean().optional(),
  })
  .passthrough()
  .superRefine((data, context) => {
    if (!data.rateLimitEnabled) return;
    if (
      !Number.isFinite(data.requestsPerSecond) ||
      Number(data.requestsPerSecond) < 1
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['requestsPerSecond'],
        message: 'Must be at least 1.',
      });
    }
    if (!Number.isFinite(data.burstSize) || Number(data.burstSize) < 1) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['burstSize'],
        message: 'Must be at least 1.',
      });
    }
    if (Number(data.burstSize) < Number(data.requestsPerSecond)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['burstSize'],
        message: 'Burst size must be ≥ requests per second.',
      });
    }
    if (Number(data.maxRetries) > 100) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['maxRetries'],
        message: 'Must be 100 or fewer.',
      });
    }
    if (Number(data.maxWaitMs) > 3_600_000) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['maxWaitMs'],
        message: 'Must be 3600000 ms (1 hour) or less.',
      });
    }
  });

export function DynamicConnectionForm({
  connectionType,
  initValues,
  isLoading,
  onSubmit,
  mode = 'create',
  onDelete,
  isDeleting,
  rateLimitStatus,
  showReconnect,
  onReconnect,
  isReconnecting,
  conflictNotice,
  reconnectNotice,
  oauthCreateHint,
}: DynamicConnectionFormProps) {
  const editProjection = initValues?.editProjection as
    EditProjection | undefined;
  const secretState = editProjection?.secretState ?? EMPTY_SECRET_STATE;
  const [clearedSecrets, setClearedSecrets] = useState<Set<string>>(
    () => new Set()
  );
  // A platform OAuth app stands in for the client credentials: offered first
  // when creating, and named by an existing connection that uses one.
  const managedApps = useMemo(
    () => managedAppsOf(connectionType),
    [connectionType]
  );
  const existingPlatformApp = platformAppOf(
    editProjection?.values as Record<string, unknown> | undefined
  );
  const [chosenPlatformApp, setChosenPlatformApp] = useState<string | null>(
    () => managedApps[0]?.id ?? null
  );
  const platformApp = mode === 'edit' ? existingPlatformApp : chosenPlatformApp;
  const baseDefinition = useMemo(() => {
    const built = buildConnectionFormDefinition(
      connectionType as ConnectionTypeWithForm,
      mode,
      secretState
    );
    return platformApp ? withoutPlatformAppCredentials(built) : built;
  }, [connectionType, mode, secretState, platformApp]);
  const definition = useMemo(() => {
    const built = buildConnectionFormDefinition(
      connectionType as ConnectionTypeWithForm,
      mode,
      secretState,
      clearedSecrets
    );
    return platformApp ? withoutPlatformAppCredentials(built) : built;
  }, [clearedSecrets, connectionType, mode, secretState, platformApp]);
  const canonicalDefaults = useMemo(
    () => buildConnectionParameterValues(baseDefinition, initValues, mode),
    [baseDefinition, initValues, mode]
  );
  const defaultRateLimit = connectionType.defaultRateLimitConfig;
  const existingRateLimit = initValues?.rateLimitConfig as
    RateLimitConfigDto | undefined;
  const formValues = useMemo(
    () => ({
      ...canonicalDefaults,
      rateLimitEnabled: Boolean(existingRateLimit),
      requestsPerSecond:
        existingRateLimit?.requestsPerSecond ??
        defaultRateLimit?.requestsPerSecond ??
        '',
      burstSize:
        existingRateLimit?.burstSize ?? defaultRateLimit?.burstSize ?? '',
      maxRetries:
        existingRateLimit?.maxRetries ?? defaultRateLimit?.maxRetries ?? '',
      maxWaitMs:
        existingRateLimit?.maxWaitMs ?? defaultRateLimit?.maxWaitMs ?? '',
      retryOnLimit:
        existingRateLimit?.retryOnLimit ??
        defaultRateLimit?.retryOnLimit ??
        true,
      defaultFor: Array.isArray(initValues?.defaultFor)
        ? initValues.defaultFor
        : [],
      isDefaultFileStorage: Boolean(initValues?.isDefaultFileStorage),
    }),
    [canonicalDefaults, defaultRateLimit, existingRateLimit, initValues]
  );
  const form = useForm<Record<string, unknown>>({
    // The form also carries the connection type's dynamic fields, which the
    // frame schema passes through, so it stays typed as an open record.
    resolver: zodResolver(
      frameSchema as z.ZodType<Record<string, unknown>, Record<string, unknown>>
    ),
    values: formValues,
    // Background refetches must not clobber in-progress edits; the explicit
    // reset on version change below handles the post-save clean state.
    resetOptions: { keepDirtyValues: true },
  });
  const watched = useWatch({ control: form.control });
  const [analysis, setAnalysis] = useState<FormAnalysisResult | null>(null);
  const [submitAttempt, setSubmitAttempt] = useState(0);
  const formValue = Object.fromEntries(
    Object.keys(definition.fields).map((name) => [name, watched[name]])
  );
  const { isDirty, dirtyFields } = form.formState;
  const hasPendingChanges = isDirty || clearedSecrets.size > 0;
  const dirtyCount = Object.values(dirtyFields).filter(Boolean).length;
  const setBlocker = useNavigationBlockerStore((state) => state.setBlocker);

  // Whether a version bump can be our own save landing. Only then are staged
  // edits done with. A bump we did not cause (a reconnect storing its token,
  // or another writer) used to drop them too (CN-18): it now takes the new
  // values for untouched fields and keeps the edits, whose save then meets
  // the version check if they really conflict.
  const savedSinceVersionRef = useRef(false);
  const saveAndReconnectRef = useRef(false);

  // On our own save: re-sync to the fresh projection and drop staged edits so
  // secret inputs empty out and the save bar collapses. The controlled
  // FieldControls read from useWatch, and with keepDirtyValues a bare
  // reset() doesn't reliably re-emit, so set each field explicitly first.
  useEffect(() => {
    if (!savedSinceVersionRef.current) {
      form.reset(formValues, { keepDirtyValues: true });
      return;
    }
    savedSinceVersionRef.current = false;
    setClearedSecrets(new Set());
    for (const [name, value] of Object.entries(formValues)) {
      form.setValue(name, value, { shouldDirty: false });
    }
    form.reset(formValues);
    // formValues is intentionally not a dependency: only a version change
    // may discard in-progress edits.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editProjection?.version]);

  useEffect(() => {
    setBlocker(hasPendingChanges, () => {
      form.reset();
      setClearedSecrets(new Set());
    });
    return () => setBlocker(false);
  }, [hasPendingChanges, setBlocker, form]);

  useEffect(() => {
    if (!hasPendingChanges) return;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [hasPendingChanges]);

  const handleDiscard = () => {
    // The controlled FieldControls read from useWatch, and with
    // keepDirtyValues a bare reset() doesn't always re-emit; set each field
    // back explicitly (the same path typing uses) then clear dirty state.
    for (const [name, value] of Object.entries(formValues)) {
      form.setValue(name, value, { shouldDirty: false });
    }
    form.reset(formValues);
    setClearedSecrets(new Set());
  };

  // The frame schema (title, rate limits) can block the submit before
  // handleSubmit runs, and pristine parameter fields keep their issues hidden
  // until a submit attempt — count this as one so they surface. Every submit
  // path reports it, the status card's Save & Reconnect too (CN-15).
  const handleInvalid = (errors: FieldErrors<Record<string, unknown>>) => {
    saveAndReconnectRef.current = false;
    setSubmitAttempt((attempt) => attempt + 1);
    reportFirstFormError(form, errors);
  };

  const handleSubmit = async (values: Record<string, unknown>) => {
    const descriptorFields =
      (connectionType as ConnectionTypeWithForm).formDefinition?.fields ?? {};
    const parameters = buildConnectionCreateParameters(
      (connectionType as ConnectionTypeWithForm).formDefinition ?? {
        fields: {},
      },
      values
    );
    const submissionData = Object.fromEntries(
      Object.keys(definition.fields).map((name) => [name, values[name]])
    );
    const submissionAnalysis = await analyzeFormWithRust(
      definition,
      submissionData
    );
    setAnalysis(submissionAnalysis);
    setSubmitAttempt((attempt) => attempt + 1);
    if (!submissionAnalysis.wasmAvailable || !submissionAnalysis.valid) {
      toast.error('Fix the highlighted connection fields before saving.');
      return;
    }
    // Read-access fields are server-managed (e.g. OAuth-captured realm_id) and
    // must never be supplied — creation rejects them outright. Strip them from
    // the submission so the merge below can't reintroduce a displayed default.
    const kept = Object.fromEntries(
      Object.entries({ ...values, ...parameters }).filter(
        ([name]) => descriptorFields[name]?.access !== 'read'
      )
    );
    // On a platform app the connection names it and has no credentials of
    // its own to send.
    const submission =
      mode === 'create' && platformApp
        ? onPlatformApp(kept, platformApp)
        : kept;
    savedSinceVersionRef.current = true;
    // "Save & Reconnect", from the save bar or the status card's guard, used
    // to only save (CN-14).
    const reconnect =
      saveAndReconnectRef.current || (mode === 'edit' && hasReauthChanges);
    saveAndReconnectRef.current = false;
    onSubmit(submission, {
      reconnect,
      clearSecrets: [...clearedSecrets].sort(),
      dirtyFields: Object.entries(form.formState.dirtyFields)
        .filter(([, dirty]) => dirty === true)
        .map(([name]) => name)
        .sort(),
    });
  };

  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const connectionTitle =
    (typeof watched.title === 'string' && watched.title.trim()) ||
    (initValues as { title?: string })?.title ||
    'this connection';

  // Descriptor parameter fields (not the title/rate-limit frame) with unsaved
  // edits, plus staged secret clears — the set the status card guards against
  // a stale-credential reconnect. `title` is injected into definition.fields by
  // the adapter but is frame chrome, not a credential, so it's excluded.
  const touchedParamFields = new Set<string>([
    ...Object.entries(dirtyFields)
      .filter(
        ([name, dirty]) =>
          dirty === true && name !== 'title' && name in definition.fields
      )
      .map(([name]) => name),
    ...clearedSecrets,
  ]);
  const hasParamChanges = touchedParamFields.size > 0;
  const hasReauthChanges = patchStripsAuthorization(
    connectionType.fieldBehaviors,
    touchedParamFields
  );
  const configuredSecretCount = Object.values(secretState).filter(
    (state) => state.configured
  ).length;

  const showSaveBar =
    mode === 'create' || hasPendingChanges || Boolean(isLoading);

  return (
    <NextForm
      form={form}
      onSubmit={handleSubmit}
      onInvalid={handleInvalid}
      className="w-full"
      renderActions={() => null}
      renderContent={() => (
        <ConnectionPageShell
          mode={mode}
          integrationIcon={
            <ServiceIcon
              serviceId={connectionType.integrationId || undefined}
              category={connectionType.category || undefined}
            />
          }
          integrationName={connectionType.displayName || undefined}
          integrationCategory={connectionType.category || undefined}
          footer={
            showSaveBar ? (
              <ConnectionSaveBar
                isLoading={isLoading}
                isSubmitDisabled={analysis?.wasmAvailable === false}
                submitLabel={
                  mode === 'edit'
                    ? hasReauthChanges
                      ? 'Save & Reconnect'
                      : 'Save changes'
                    : oauthCreateHint
                      ? 'Create & Connect'
                      : 'Create connection'
                }
                loadingLabel={mode === 'edit' ? 'Saving...' : 'Creating...'}
                dirtyCount={dirtyCount}
                clearedCount={clearedSecrets.size}
                showDiscard={mode === 'edit' && hasPendingChanges}
                onDiscard={handleDiscard}
              />
            ) : undefined
          }
        >
          <div className="space-y-6">
            {conflictNotice}
            {reconnectNotice}
            {mode === 'create' && managedApps.length > 0 && (
              <PlatformAppChoice
                provider={connectionType.displayName || 'the provider'}
                apps={managedApps}
                chosen={chosenPlatformApp}
                onChoose={setChosenPlatformApp}
              />
            )}
            {mode === 'edit' && existingPlatformApp && (
              <PlatformAppNotice
                provider={connectionType.displayName || 'the provider'}
                app={
                  managedApps.find((app) => app.id === existingPlatformApp)
                    ?.displayName ?? existingPlatformApp
                }
              />
            )}
            {mode === 'create' && oauthCreateHint && (
              <div className="rounded-lg border border-info/40 bg-info/10 px-4 py-3 text-sm text-foreground">
                After creating, a {connectionType.displayName || 'provider'}{' '}
                window opens to authorize the connection.
              </div>
            )}
            {mode === 'edit' && (
              <ConnectionStatusCard
                status={
                  ((initValues as { status?: ConnectionStatus })?.status ??
                    'UNKNOWN') as ConnectionStatus
                }
                connectionType={connectionType as ConnectionTypeWithForm}
                values={editProjection?.values as Record<string, unknown>}
                configuredSecretCount={configuredSecretCount}
                updatedAt={(initValues as { updatedAt?: string })?.updatedAt}
                grantState={
                  (initValues as { grantState?: ConnectionGrantState | null })
                    ?.grantState
                }
                isOAuth={Boolean(showReconnect)}
                onReconnect={onReconnect}
                onSaveAndReconnect={() => {
                  saveAndReconnectRef.current = true;
                  void form.handleSubmit(handleSubmit, handleInvalid)();
                }}
                isReconnecting={isReconnecting}
                hasParamChanges={hasParamChanges}
                hasReauthChanges={hasReauthChanges}
              />
            )}
            <FormRenderer
              definition={definition}
              value={formValue}
              onChange={(next) => {
                for (const [name, value] of Object.entries(next)) {
                  form.setValue(name, value, { shouldDirty: true });
                }
              }}
              frame={{
                commitField: ({ fieldName, value }) => {
                  form.setValue(fieldName, value, { shouldDirty: true });
                  if (value !== '' && value !== null && value !== undefined) {
                    setClearedSecrets((current) => {
                      if (!current.has(fieldName)) return current;
                      const next = new Set(current);
                      next.delete(fieldName);
                      return next;
                    });
                  }
                },
              }}
              onAnalysisChange={setAnalysis}
              submitAttempt={submitAttempt}
              fieldAnnotations={Object.fromEntries(
                Object.entries(secretState).map(([name, state]) => {
                  const field = definition.fields[name];
                  const behavior = connectionType.fieldBehaviors[name];
                  const label = field?.label ?? name.replace(/_/g, ' ');
                  return [
                    name,
                    <ConnectionFieldFrame
                      key={name}
                      label={label}
                      configured={state.configured}
                      clearable={state.clearable}
                      cleared={clearedSecrets.has(name)}
                      requiresReauthorization={
                        behavior?.requiresReauthorization
                      }
                      onClear={() => {
                        setClearedSecrets((current) =>
                          new Set(current).add(name)
                        );
                        form.setValue(name, '', { shouldDirty: true });
                      }}
                      onUndoClear={() => {
                        setClearedSecrets((current) => {
                          const next = new Set(current);
                          next.delete(name);
                          return next;
                        });
                      }}
                    />,
                  ];
                })
              )}
            />
            <DefaultForSection connectionType={connectionType} />
            <CollapsedSection
              label="Advanced"
              description="Rate limiting and retry behavior"
              forceOpen={Boolean(watched.rateLimitEnabled)}
            >
              <RateLimitSection
                defaultConfig={connectionType.defaultRateLimitConfig}
                liveStatus={rateLimitStatus}
              />
            </CollapsedSection>
            {mode === 'edit' && onDelete && (
              <DangerZoneSection
                isOAuth={Boolean(showReconnect)}
                isDeleting={Boolean(isDeleting)}
                onRequestDelete={() => setDeleteDialogOpen(true)}
              />
            )}
            {mode === 'edit' && onDelete && (
              <DeleteConnectionDialog
                open={deleteDialogOpen}
                onOpenChange={setDeleteDialogOpen}
                title={connectionTitle}
                isOAuth={Boolean(showReconnect)}
                isDeleting={Boolean(isDeleting)}
                onConfirm={onDelete}
              />
            )}
          </div>
        </ConnectionPageShell>
      )}
    />
  );
}
