import { useState } from 'react';
import {
  useInfiniteQuery,
  useMutation,
  useQueryClient,
} from '@tanstack/react-query';
import { MoreHorizontal, Pencil, Plus, Settings, Trash2 } from 'lucide-react';
import { ConversationSettingsDialog } from '@/features/workflows/components/ConversationSettingsDialog';
import { toast } from 'sonner';
import type { ConversationSummary } from '@/generated/RuntaraRuntimeApi';
import { cn, formatRelativeTime } from '@/lib/utils';
import { useToken } from '@/shared/hooks/useToken';
import { queryKeys } from '@/shared/queries/query-keys';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/shared/components/ui/alert-dialog';
import { Badge } from '@/shared/components/ui/badge';
import { Button } from '@/shared/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/shared/components/ui/dropdown-menu';
import { Input } from '@/shared/components/ui/input';
import { Label } from '@/shared/components/ui/label';
import { Spinner } from '@/shared/components/ui/spinner';
import { Switch } from '@/shared/components/ui/switch';
import { conversationName } from './conversation-name';
import {
  deleteConversation,
  listConversations,
  openConversation,
} from '@/features/workflows/queries/conversations';

/** The list has no stream: it is read again this often while it is shown,
 * and when the window is returned to. */
const REFRESH_MS = 30_000;
/** The keys of the conversations this console starts. */
const CONSOLE_PREFIX = 'console:';

interface ConversationListProps {
  workflowId: string;
  /** The conversation the page shows. */
  activeKey: string | null;
  onOpen: (key: string) => void;
  onNew: () => void;
  /** Told when a conversation's title was changed here. */
  onRenamed?: (key: string, title: string | null) => void;
  /** Told when a conversation was deleted here. */
  onDeleted?: (key: string) => void;
  className?: string;
}

/**
 * The workflow's conversations, most recently active first: every one of
 * them, those adapters and other workflows opened too, unless narrowed to
 * the ones this console started.
 */
export function ConversationList({
  workflowId,
  activeKey,
  onOpen,
  onNew,
  onRenamed,
  onDeleted,
  className,
}: ConversationListProps) {
  const token = useToken();
  const queryClient = useQueryClient();
  const [consoleOnly, setConsoleOnly] = useState(false);
  const [renaming, setRenaming] = useState<ConversationSummary | null>(null);
  const [deleting, setDeleting] = useState<ConversationSummary | null>(null);
  const [configuring, setConfiguring] = useState<string | null>(null);
  const listKey = queryKeys.workflows.conversations(workflowId);

  const list = useInfiniteQuery({
    queryKey: [...listKey, { consoleOnly }],
    queryFn: ({ pageParam, signal }) =>
      listConversations(
        token,
        workflowId,
        {
          cursor: pageParam,
          prefix: consoleOnly ? CONSOLE_PREFIX : undefined,
        },
        signal
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.next ?? undefined,
    enabled: !!token && !!workflowId,
    refetchInterval: REFRESH_MS,
    refetchOnWindowFocus: true,
  });
  const conversations = list.data?.pages.flatMap((p) => p.conversations) ?? [];

  const rename = useMutation({
    mutationFn: ({ key, title }: { key: string; title: string | null }) =>
      openConversation(token, workflowId, key, { title }),
    onSuccess: (_state, { key, title }) => {
      setRenaming(null);
      onRenamed?.(key, title);
      void queryClient.invalidateQueries({ queryKey: listKey });
    },
    onError: (error) =>
      toast.error(
        error instanceof Error ? error.message : 'Could not rename it'
      ),
  });

  const remove = useMutation({
    mutationFn: (key: string) => deleteConversation(token, workflowId, key),
    onSuccess: (_nothing, key) => {
      setDeleting(null);
      onDeleted?.(key);
      void queryClient.invalidateQueries({ queryKey: listKey });
    },
    onError: (error) =>
      toast.error(
        error instanceof Error ? error.message : 'Could not delete it'
      ),
  });

  return (
    <aside
      aria-label="Conversations"
      className={cn('flex w-72 shrink-0 flex-col border-r', className)}
    >
      <div className="flex items-center justify-between gap-2 border-b px-3 py-3">
        <h2 className="text-sm font-semibold">Conversations</h2>
        <Button variant="secondary" size="sm" onClick={onNew}>
          <Plus className="size-3.5" />
          New chat
        </Button>
      </div>
      <div className="flex items-center justify-between gap-2 border-b px-3 py-2">
        <Label htmlFor="console-only" className="text-xs font-normal">
          Only those started here
        </Label>
        <Switch
          id="console-only"
          checked={consoleOnly}
          onCheckedChange={setConsoleOnly}
        />
      </div>

      <div className="flex-1 overflow-y-auto">
        {list.isPending ? (
          <div className="flex justify-center py-6">
            <Spinner className="size-4" />
          </div>
        ) : list.isError ? (
          <p className="px-3 py-4 text-xs text-destructive">
            The conversations could not be listed.
          </p>
        ) : conversations.length === 0 ? (
          <p className="px-3 py-4 text-xs text-muted-foreground">
            No conversations yet.
          </p>
        ) : (
          <ul>
            {conversations.map((conversation) => (
              <li
                key={conversation.key}
                className={cn(
                  'group flex items-start gap-1 border-b px-3 py-2',
                  conversation.key === activeKey && 'bg-muted'
                )}
              >
                <button
                  type="button"
                  className="min-w-0 flex-1 text-left"
                  aria-current={
                    conversation.key === activeKey ? 'true' : undefined
                  }
                  onClick={() => onOpen(conversation.key)}
                >
                  <span className="block truncate text-sm">
                    {conversationName(conversation)}
                  </span>
                  <span className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                    {conversation.waiting ? (
                      <Badge variant="outline" className="py-0 text-3xs">
                        Waiting
                      </Badge>
                    ) : conversation.active ? (
                      <Badge variant="outline" className="py-0 text-3xs">
                        Active
                      </Badge>
                    ) : null}
                    <span className="truncate">
                      {formatRelativeTime(conversation.updatedAt)}
                    </span>
                  </span>
                </button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="secondary"
                      size="icon"
                      className="size-7 shrink-0"
                      aria-label={`Actions for ${conversationName(conversation)}`}
                    >
                      <MoreHorizontal className="size-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem
                      onSelect={() => setRenaming(conversation)}
                    >
                      <Pencil className="size-3.5" />
                      Rename
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onSelect={() => setConfiguring(conversation.key)}
                    >
                      <Settings className="size-3.5" />
                      Settings
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      className="text-destructive"
                      onSelect={() => setDeleting(conversation)}
                    >
                      <Trash2 className="size-3.5" />
                      Delete
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </li>
            ))}
          </ul>
        )}
        {list.hasNextPage && (
          <div className="flex justify-center py-3">
            <Button
              variant="secondary"
              size="sm"
              disabled={list.isFetchingNextPage}
              onClick={() => void list.fetchNextPage()}
            >
              {list.isFetchingNextPage && <Spinner className="size-3" />}
              Load more
            </Button>
          </div>
        )}
      </div>

      {renaming && (
        <RenameDialog
          conversation={renaming}
          saving={rename.isPending}
          onClose={() => setRenaming(null)}
          onSave={(title) => rename.mutate({ key: renaming.key, title })}
        />
      )}

      {configuring && (
        <ConversationSettingsDialog
          workflowId={workflowId}
          conversationKey={configuring}
          onClose={() => setConfiguring(null)}
        />
      )}

      <AlertDialog
        open={!!deleting}
        onOpenChange={(open) => !open && setDeleting(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this conversation?</AlertDialogTitle>
            <AlertDialogDescription>
              Everything said in “{deleting ? conversationName(deleting) : ''}”
              is deleted with it, and cannot be brought back. A run that carries
              it now is left to end.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={remove.isPending}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={remove.isPending}
              onClick={(event) => {
                // Closed when it is deleted, not before.
                event.preventDefault();
                if (deleting) remove.mutate(deleting.key);
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </aside>
  );
}

function RenameDialog({
  conversation,
  saving,
  onClose,
  onSave,
}: {
  conversation: ConversationSummary;
  saving: boolean;
  onClose: () => void;
  onSave: (title: string | null) => void;
}) {
  const [title, setTitle] = useState(conversation.title ?? '');
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            // An empty title removes it: the list then shows what was said.
            onSave(title.trim() || null);
          }}
        >
          <DialogHeader>
            <DialogTitle>Rename conversation</DialogTitle>
            <DialogDescription>
              Leave it empty to show the last thing said instead.
            </DialogDescription>
          </DialogHeader>
          <div className="my-4 space-y-2">
            <Label htmlFor="conversation-title">Title</Label>
            <Input
              id="conversation-title"
              value={title}
              maxLength={200}
              autoFocus
              onChange={(event) => setTitle(event.target.value)}
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving && <Spinner className="size-3" />}
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
