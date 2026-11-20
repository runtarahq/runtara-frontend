import { useEffect, useCallback, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router';
import {
  ArrowLeft,
  ChevronDown,
  MessageSquareOff,
  PanelLeft,
  Settings,
  Square,
} from 'lucide-react';
import { ConversationSettingsDialog } from '@/features/workflows/components/ConversationSettingsDialog';
import { useQueryClient } from '@tanstack/react-query';
import { ConversationList } from '@/features/workflows/components/ConversationList';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/shared/components/ui/dropdown-menu';
import { WorkflowDto } from '@/generated/RuntaraRuntimeApi';
import { Button } from '@/shared/components/ui/button.tsx';
import { Skeleton } from '@/shared/components/ui/skeleton';
import { usePageTitle } from '@/shared/hooks/usePageTitle';
import { useCustomQuery } from '@/shared/hooks/api';
import { queryKeys } from '@/shared/queries/query-keys';
import { getWorkflow, getWorkflowInstance } from '@/features/workflows/queries';
import { fetchChatHistory } from '@/features/workflows/queries/chat';
import {
  conversationKeyOfRun,
  conversationPath,
} from '@/features/workflows/utils/run-conversation';
import { useToken } from '@/shared/hooks/useToken';
import { useChatStore } from '@/features/workflows/stores/chatStore';
import { useChatStream } from './useChatStream';
import { ChatMessageList } from '@/features/workflows/components/ChatMessageList';
import { ChatInput } from '@/features/workflows/components/ChatInput';
import { toast } from 'sonner';

export function ChatPage() {
  const {
    workflowId,
    instanceId,
    conversationKey: routeKey,
  } = useParams<{
    workflowId: string;
    instanceId?: string;
    conversationKey?: string;
  }>();
  const navigate = useNavigate();
  const token = useToken();

  // Fetch workflow details for the header
  const { data: workflowResponse } = useCustomQuery({
    queryKey: queryKeys.workflows.byId(workflowId ?? ''),
    queryFn: (token: string) => getWorkflow(token, workflowId!),
    enabled: !!workflowId,
  });

  const workflow = (workflowResponse as { data?: WorkflowDto } | undefined)
    ?.data;
  const workflowName = workflow?.name ?? 'Chat';

  // The server reports whether the graph contains a step that waits for a
  // reply. Without one nothing ever reads what is typed here, so starting a
  // session is a dead end and the page says so instead. Direct URLs still land
  // here — this is the fallback for them, not a redirect.
  //
  // Resuming a run (`:instanceId`) or a conversation that exists is exempt:
  // it already has a transcript, and Invocation History only links here for
  // a run that is holding a pending input. Refusing that would block the one
  // reply the user came to give.
  const isWorkflowLoaded = !!workflow;
  const supportsChat = workflow?.supportsChat === true;
  const isDeadEnd =
    isWorkflowLoaded && !instanceId && !routeKey && !supportsChat;

  // Chat store state
  const messages = useChatStore((s) => s.messages);
  const status = useChatStore((s) => s.status);
  const loading = useChatStore((s) => s.loading);
  const queued = useChatStore((s) => s.queued);
  const hasEarlier = useChatStore((s) => s.hasEarlier);
  const loadingEarlier = useChatStore((s) => s.loadingEarlier);
  const title = useChatStore((s) => s.title);
  const waitingForInput = useChatStore((s) => s.waitingForInput);
  const pendingInputs = useChatStore((s) => s.pendingInputs);
  const pendingInputError = useChatStore((s) => s.pendingInputError);
  const error = useChatStore((s) => s.error);
  const storeInstanceId = useChatStore((s) => s.instanceId);
  const conversationKey = useChatStore((s) => s.conversationKey);

  usePageTitle(`Chat - ${title || workflowName}`);

  // Chat stream actions
  const {
    startSession,
    reconnect,
    sendMessage,
    submitInput,
    retryMessage,
    retryResponse,
    loadEarlier,
    stop,
    cancelStream,
    uncertainMessages,
    uncertainResponses,
  } = useChatStream(workflowId ?? '');

  // What the page shows now: a conversation by its key, a run, or a new
  // chat. It changes with the URL, and a change replaces what was shown.
  const shown = useRef<string | null>(null);
  // The conversation this page started itself. Its URL is replaced with the
  // conversation's own once it exists, and that is not a change of chat.
  const started = useRef<string | null>(null);

  useEffect(() => {
    if (!workflowId) return;
    // Nothing starts until the workflow has answered — a new session on a
    // workflow that never waits allocated an instance for a chat that could
    // never reply.
    if (!isWorkflowLoaded || isDeadEnd) return;
    const target = routeKey
      ? `conversation:${routeKey}`
      : instanceId
        ? `run:${instanceId}`
        : 'new';
    if (shown.current === target) return;
    if (routeKey && started.current === routeKey) {
      shown.current = target;
      return;
    }
    shown.current = target;
    started.current = null;
    cancelStream();

    const store = useChatStore.getState();
    const isShown = () => shown.current === target;
    const chatUrl = (key: string) => conversationPath(workflowId, key);

    if (routeKey) {
      // A conversation that exists: its events are its transcript, and the
      // stream carries on from there.
      store.initChat(workflowId, workflowName);
      void reconnect(routeKey);
    } else if (instanceId) {
      store.resumeChat(workflowId, workflowName, instanceId);

      // A run a conversation started names it in its input, and is shown as
      // that conversation. A run nothing of the kind started (one waiting
      // for input, opened from Invocation History) has only its own history.
      getWorkflowInstance(token, workflowId, instanceId)
        .then(async (instanceData) => {
          if (!isShown()) return;
          const key = conversationKeyOfRun(instanceData);
          if (key) {
            navigate(chatUrl(key), { replace: true });
            return;
          }
          const historyMessages = await fetchChatHistory(
            token,
            workflowId,
            instanceId
          );
          if (isShown()) store.loadHistory(historyMessages);
        })
        .catch(() => {
          if (isShown()) toast.error('Failed to load chat history');
        });
    } else {
      store.initChat(workflowId, workflowName);
      // Start a new conversation: the workflow begins, and speaks first. Its
      // URL becomes the conversation's, so a refresh reopens the same one.
      void startSession((key) => {
        if (!isShown()) return;
        started.current = key;
        navigate(chatUrl(key), { replace: true });
      });
    }
  }, [workflowId, instanceId, routeKey, isWorkflowLoaded, isDeadEnd]); // eslint-disable-line react-hooks/exhaustive-deps

  // Leaving the page stops reading. It does not stop the run.
  useEffect(
    () => () => {
      shown.current = null;
      started.current = null;
      cancelStream();
      useChatStore.getState().resetChat();
    },
    [] // eslint-disable-line react-hooks/exhaustive-deps
  );

  const handleBack = useCallback(() => {
    navigate(`/workflows/${workflowId}`);
  }, [navigate, workflowId]);

  // The workflow's conversations, beside the one shown.
  const [listShown, setListShown] = useState(true);
  const [settingsShown, setSettingsShown] = useState(false);
  const queryClient = useQueryClient();
  // The list has no stream of its own. What this page changes in it (a new
  // conversation, a title) is read again at once.
  useEffect(() => {
    if (!workflowId || !conversationKey) return;
    void queryClient.invalidateQueries({
      queryKey: queryKeys.workflows.conversations(workflowId),
    });
  }, [queryClient, workflowId, conversationKey, title]);
  const openChat = useCallback(
    (key?: string) =>
      navigate(
        key && workflowId
          ? conversationPath(workflowId, key)
          : `/workflows/${workflowId}/chat`
      ),
    [navigate, workflowId]
  );

  return (
    <div className="flex h-dvh overflow-hidden">
      {listShown && workflowId && !isDeadEnd && (
        <ConversationList
          workflowId={workflowId}
          activeKey={conversationKey}
          onOpen={openChat}
          onNew={() => openChat()}
          onRenamed={(key, renamed) => {
            if (key === conversationKey)
              useChatStore.getState().setTitle(renamed);
          }}
          onDeleted={(key) => {
            // The one shown is gone: a new chat takes its place.
            if (key === conversationKey) openChat();
          }}
          className="hidden md:flex"
        />
      )}
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center gap-3 border-b px-4 py-3">
          <Button
            variant="secondary"
            size="icon"
            onClick={handleBack}
            className="size-8"
          >
            <ArrowLeft className="size-4" />
          </Button>
          {!isDeadEnd && (
            <Button
              variant="secondary"
              size="icon"
              onClick={() => setListShown((shown) => !shown)}
              className="hidden size-8 md:inline-flex"
              aria-label={
                listShown ? 'Hide conversations' : 'Show conversations'
              }
              aria-pressed={listShown}
            >
              <PanelLeft className="size-4" />
            </Button>
          )}
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-sm font-semibold">
              {title || workflowName}
            </h1>
            {(title || storeInstanceId) && (
              <p className="truncate text-xs text-muted-foreground">
                {[
                  title ? workflowName : null,
                  storeInstanceId ? `Instance: ${storeInstanceId}` : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </p>
            )}
          </div>
          {conversationKey && (
            <Button
              variant="secondary"
              size="icon"
              className="size-8"
              aria-label="Conversation settings"
              onClick={() => setSettingsShown(true)}
            >
              <Settings className="size-4" />
            </Button>
          )}
          {queued > 1 && (
            <span className="text-xs text-muted-foreground">
              {queued} messages waiting
            </span>
          )}
          {/* While a run carries the conversation it can be stopped. Leaving
            the page does not stop it. */}
          {conversationKey &&
            (status === 'streaming' || status === 'waiting_for_input') && (
              <div className="flex items-center">
                <Button
                  variant="secondary"
                  size="sm"
                  className="rounded-r-none"
                  onClick={() => void stop()}
                >
                  <Square className="size-3" />
                  Stop
                </Button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="secondary"
                      size="sm"
                      className="rounded-l-none border-l px-1.5"
                      aria-label="More ways to stop"
                    >
                      <ChevronDown className="size-3" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onSelect={() => void stop(true)}>
                      Stop and discard queued messages
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            )}
        </div>

        {/* Error banner */}
        {(error || pendingInputError) && (
          <div className="mx-4 mt-2 rounded-lg border border-destructive/50 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {error || pendingInputError}
          </div>
        )}

        {isDeadEnd ? (
          <div className="flex flex-1 flex-col items-center justify-center px-4 text-center">
            <MessageSquareOff className="mb-3 size-10 text-muted-foreground/40" />
            <p className="text-sm font-medium text-foreground">
              This workflow does not support chat
            </p>
            <p className="mt-1 max-w-md text-xs text-muted-foreground">
              A conversation needs a step that waits for your reply. Add a Wait
              for signal step — on its own, or as an AI Agent tool — and this
              workflow will start accepting messages.
            </p>
            <Button variant="secondary" className="mt-4" onClick={handleBack}>
              Open workflow
            </Button>
          </div>
        ) : (
          <>
            {/* Message list */}
            {loading ? (
              <div
                className="flex flex-1 flex-col gap-3 px-4 py-4"
                role="status"
                aria-label="Loading the conversation"
              >
                <Skeleton className="h-10 w-2/5 self-end" />
                <Skeleton className="h-16 w-3/5" />
                <Skeleton className="h-10 w-1/3 self-end" />
              </div>
            ) : (
              <ChatMessageList
                messages={messages}
                hasEarlier={hasEarlier}
                loadingEarlier={loadingEarlier}
                onLoadEarlier={() => void loadEarlier()}
              />
            )}
            {uncertainResponses?.map((response) => (
              <div
                key={response.operationId}
                className="space-y-2 border-t px-4 py-2 text-sm"
              >
                <p>
                  Response to {response.request.message || 'input request'} is
                  unconfirmed.
                </p>
                <Button
                  variant="secondary"
                  onClick={() =>
                    void retryResponse(
                      response.request.requestId,
                      response.payload,
                      response.instanceId,
                      response.operationId
                    )
                  }
                >
                  Retry original response
                </Button>
              </div>
            ))}
            {uncertainMessages
              .filter(
                (unconfirmed) => unconfirmed.conversationKey === conversationKey
              )
              .map(({ id, message }) => (
                <div key={id} className="space-y-2 border-t px-4 py-2 text-sm">
                  <p>Message receipt is unconfirmed: {message}</p>
                  <Button
                    variant="secondary"
                    aria-label={`Retry this message: ${message}`}
                    onClick={() => void retryMessage(id)}
                  >
                    Retry this message
                  </Button>
                </div>
              ))}

            {/* Input */}
            <ChatInput
              onSend={sendMessage}
              onSignalResponse={sendMessage}
              status={status}
              waitingForInput={waitingForInput}
              pendingInputs={pendingInputs}
              onSelectInput={(input) =>
                useChatStore.getState().setWaitingForInput(input)
              }
              onSubmitInput={submitInput}
              key={conversationKey ?? storeInstanceId ?? 'new-conversation'}
            />
          </>
        )}
      </div>
      {settingsShown && workflowId && conversationKey && (
        <ConversationSettingsDialog
          workflowId={workflowId}
          conversationKey={conversationKey}
          onClose={() => setSettingsShown(false)}
        />
      )}
    </div>
  );
}
