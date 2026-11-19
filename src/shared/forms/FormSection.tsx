import { useEffect, useState, type ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';

interface FormSectionProps {
  /** Without a title the fields are laid out with no frame around them. */
  title?: string;
  description?: string;
  icon?: LucideIcon;
  /** Marks the section as one that may be left empty. */
  optional?: boolean;
  /**
   * `plain` is a bordered group, as a schema's sections are drawn; `banded`
   * sets the title on a band above the fields, for the sections of a page.
   */
  variant?: 'plain' | 'banded';
  /** Starts closed and opens on its title: for advanced settings. */
  collapsible?: boolean;
  /** Opens a collapsible section when it becomes true. */
  forceOpen?: boolean;
  /** How the section's fields are laid out; stacked by default. */
  fieldsClassName?: string;
  children: ReactNode;
}

/** A titled group of fields: the one section every form here is built of. */
export function FormSection({
  title,
  description,
  icon: Icon,
  optional,
  variant = 'plain',
  collapsible = false,
  forceOpen,
  fieldsClassName = 'space-y-4',
  children,
}: FormSectionProps) {
  const [open, setOpen] = useState(Boolean(forceOpen));
  useEffect(() => {
    if (forceOpen) setOpen(true);
  }, [forceOpen]);

  if (!title) {
    return <div className={fieldsClassName}>{children}</div>;
  }

  if (variant === 'banded') {
    return (
      <div className="overflow-hidden rounded-lg border border-border bg-card shadow-sm">
        <div className="border-b border-border bg-muted/30 px-4 py-3">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="flex items-center gap-2 text-sm font-medium text-foreground">
                {Icon && <Icon className="size-4 text-muted-foreground" />}
                {title}
              </h3>
              {description && (
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {description}
                </p>
              )}
            </div>
            {optional && (
              <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                Optional
              </span>
            )}
          </div>
        </div>
        <div className={`${fieldsClassName} p-4`}>{children}</div>
      </div>
    );
  }

  const fields = (
    <div className={`${fieldsClassName} border-t border-border/60 pt-4`}>
      {children}
    </div>
  );

  if (collapsible) {
    return (
      <details
        open={open}
        onToggle={(event) => setOpen(event.currentTarget.open)}
        className="group rounded-lg border border-border/70 bg-card px-4 py-3"
      >
        <summary className="cursor-pointer list-none font-medium">
          {title}
          {description && (
            <span className="mt-1 block text-xs font-normal text-muted-foreground">
              {description}
            </span>
          )}
        </summary>
        <div className="mt-4">{fields}</div>
      </details>
    );
  }

  return (
    <section className="rounded-lg border border-border/70 bg-card px-4 py-4">
      <div className="mb-4">
        <h3 className="font-medium">{title}</h3>
        {description && (
          <p className="mt-1 text-xs text-muted-foreground">{description}</p>
        )}
      </div>
      {fields}
    </section>
  );
}
