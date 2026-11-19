import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/shared/components/ui/dropdown-menu';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/shared/components/ui/tooltip';
import { ArgumentValueType, ARGUMENT_VALUE_TYPE_OPTIONS } from './types';
import {
  getArgumentValueTypeColor,
  getArgumentValueTypeSymbol,
} from './arguments';

// Selector component for argument value type - compact version
export const ArgumentValueTypeSelector = ({
  value = 'immediate',
  onChange,
  disabled = false,
}: {
  value?: ArgumentValueType;
  onChange: (value: ArgumentValueType) => void;
  disabled?: boolean;
}) => {
  const selectedOption =
    ARGUMENT_VALUE_TYPE_OPTIONS.find((opt) => opt.value === value) ||
    ARGUMENT_VALUE_TYPE_OPTIONS[0];

  return (
    <TooltipProvider>
      <Tooltip>
        <DropdownMenu>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                disabled={disabled}
                className={`flex size-6 shrink-0 items-center justify-center rounded border border-current text-[9px] font-bold transition-colors hover:opacity-80 ${getArgumentValueTypeColor(
                  value
                )}`}
              >
                {getArgumentValueTypeSymbol(value)}
              </button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent className="border-0">
            <p className="text-xs font-semibold text-foreground">
              {selectedOption.label}
            </p>
            <p className="text-3xs opacity-80">{selectedOption.description}</p>
          </TooltipContent>
          <DropdownMenuContent align="end" className="w-56 p-1">
            {ARGUMENT_VALUE_TYPE_OPTIONS.map((option) => {
              const isSelected = option.value === value;
              return (
                <DropdownMenuItem
                  key={option.value}
                  onClick={() => onChange(option.value)}
                  className={`h-10 cursor-pointer rounded-md px-2 transition-colors hover:bg-accent/40 focus:bg-accent/50 ${
                    isSelected ? 'bg-accent/60 ring-1 ring-primary/30' : ''
                  }`}
                >
                  <div className="flex w-full items-center gap-2">
                    <span
                      className={`flex size-5 shrink-0 items-center justify-center rounded border text-[8px] font-bold ${getArgumentValueTypeColor(
                        option.value
                      )} ${isSelected ? 'ring-1 ring-primary' : 'border-current'}`}
                    >
                      {getArgumentValueTypeSymbol(option.value)}
                    </span>
                    <div className="flex min-w-0 flex-1 flex-col">
                      <span
                        className={`text-xs font-medium leading-tight ${isSelected ? 'text-primary-text' : ''}`}
                      >
                        {option.label}
                        {isSelected && ' ✓'}
                      </span>
                      <span className="truncate text-3xs leading-tight text-muted-foreground">
                        {option.description}
                      </span>
                    </div>
                  </div>
                </DropdownMenuItem>
              );
            })}
          </DropdownMenuContent>
        </DropdownMenu>
      </Tooltip>
    </TooltipProvider>
  );
};
