import { forwardRef, type ReactNode } from 'react';

interface RequestCardProps {
  /** What is asked. */
  title: string;
  /** Who asks, when it is not the workflow itself. */
  source?: string;
  /** Beside the title: a way out to another request. */
  aside?: ReactNode;
  children: ReactNode;
}

/**
 * What a run asks of the person, where the message box otherwise is: one
 * card in the chat's column, as a chat asks for a choice or a go-ahead.
 */
export const RequestCard = forwardRef<HTMLElement, RequestCardProps>(
  function RequestCard({ title, source, aside, children }, ref) {
    return (
      <div className="bg-background px-4 pb-3 pt-2">
        <section
          ref={ref}
          tabIndex={-1}
          aria-label={title}
          className="mx-auto w-full max-w-3xl rounded-2xl border bg-background shadow-sm outline-none"
        >
          <header className="flex items-start gap-3 px-4 pt-3.5">
            <div className="min-w-0 flex-1">
              {source && (
                <p className="mb-0.5 text-xs text-muted-foreground">{source}</p>
              )}
              <h2 className="whitespace-pre-wrap text-sm font-medium leading-relaxed">
                {title}
              </h2>
            </div>
            {aside}
          </header>
          <div className="px-4 pb-3.5 pt-3">{children}</div>
        </section>
      </div>
    );
  }
);
