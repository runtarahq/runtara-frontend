import { Icons } from '@/shared/components/icons.tsx';
import { cn } from '@/lib/utils.ts';
import { resolveStepType } from '@/features/workflows/step-types/catalog';
import { STEP_TYPE_UI } from '@/features/workflows/step-types/ui';

type Props = {
  className?: string;
  type: string;
};

// Names shown with an icon that are no DSL step type.
const OTHER_ICONS: Record<
  string,
  React.ComponentType<{ className?: string }>
> = {
  // The placeholder a new step is picked from.
  Create: Icons.add,
  Terminate: Icons.stop,
  // Legacy: graphs saved before the entry point named the first real step.
  Start: Icons.entryPoint,
};

/**
 * The icon of a step type, by its name or the display name the server gives
 * it (`step-types/ui.tsx`); a gear for a name that is neither.
 */
export function StepTypeIcon(props: Props) {
  const { className, type } = props;
  const stepType = resolveStepType(type);
  const Icon = stepType
    ? STEP_TYPE_UI[stepType].Icon
    : (OTHER_ICONS[type] ?? Icons.gear);
  return <Icon className={cn('size-4', className)} />;
}
