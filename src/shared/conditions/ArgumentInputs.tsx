import { Input } from '@/shared/components/ui/input';
import { PICKER_TRUNCATE_MAX_WIDTH } from '@/shared/components/picker-dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/shared/components/ui/select';
import { X } from 'lucide-react';
import { ImmediateValueType, IMMEDIATE_TYPE_OPTIONS } from './types';
import { VariableSuggestion } from './suggestions';
import { formatReferenceForDisplay } from './readable';

// Reference pill component to display selected reference - compact green pill style
export const ReferencePill = ({
  value,
  onRemove,
  onClick,
  disabled,
  suggestions = [],
}: {
  value: string;
  onRemove: () => void;
  onClick: () => void;
  disabled?: boolean;
  suggestions?: VariableSuggestion[];
}) => {
  const displayValue = formatReferenceForDisplay(value, suggestions);

  return (
    <span className="inline-flex items-center gap-1.5 rounded border border-success/30 bg-success/10 px-2 py-1 text-xs text-success">
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        className={`${PICKER_TRUNCATE_MAX_WIDTH} truncate hover:underline`}
        title={value}
      >
        {displayValue}
      </button>
      {!disabled && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          className="text-success/60 hover:text-success"
        >
          <X className="size-3" />
        </button>
      )}
    </span>
  );
};

// Immediate value input component with type selector - compact version
export const ImmediateValueInput = ({
  value,
  onChange,
  immediateType,
  onImmediateTypeChange,
  placeholder,
  disabled,
}: {
  value: string;
  onChange: (value: string) => void;
  immediateType: ImmediateValueType;
  onImmediateTypeChange: (type: ImmediateValueType) => void;
  placeholder?: string;
  disabled?: boolean;
}) => {
  // Render appropriate input based on immediate type
  if (immediateType === 'boolean') {
    return (
      <div className="flex flex-1 items-center gap-1.5">
        <Select
          value={value || 'true'}
          onValueChange={onChange}
          disabled={disabled}
        >
          <SelectTrigger className="h-7 flex-1 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="true" className="text-xs">
              true
            </SelectItem>
            <SelectItem value="false" className="text-xs">
              false
            </SelectItem>
          </SelectContent>
        </Select>
        <Select
          value={immediateType}
          onValueChange={(val) =>
            onImmediateTypeChange(val as ImmediateValueType)
          }
          disabled={disabled}
        >
          <SelectTrigger className="h-7 w-20 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {IMMEDIATE_TYPE_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value} className="text-xs">
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    );
  }

  return (
    <div className="flex flex-1 items-center gap-1.5">
      <Input
        type={immediateType === 'number' ? 'number' : 'text'}
        className="h-7 flex-1 text-xs"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
      />
      <Select
        value={immediateType}
        onValueChange={(val) =>
          onImmediateTypeChange(val as ImmediateValueType)
        }
        disabled={disabled}
      >
        <SelectTrigger className="h-7 w-20 text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {IMMEDIATE_TYPE_OPTIONS.map((opt) => (
            <SelectItem key={opt.value} value={opt.value} className="text-xs">
              {opt.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
};
