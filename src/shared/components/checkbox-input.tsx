import {
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
} from '@/shared/components/ui/form.tsx';
import { Switch } from '@/shared/components/ui/switch.tsx';

interface CheckboxInputProps {
  name: string;
  label: string;
  description?: string;
  disabled?: boolean;
}

export function CheckboxInput(props: CheckboxInputProps) {
  const { label, name, description, disabled } = props;

  return (
    <FormField
      name={name}
      render={({ field }) => (
        <FormItem className="flex flex-row items-center space-x-3 space-y-0">
          <FormControl>
            <Switch
              checked={field.value}
              disabled={disabled}
              onCheckedChange={field.onChange}
            />
          </FormControl>
          <div className="space-y-0.5">
            <FormLabel>{label}</FormLabel>
            {description && <FormDescription>{description}</FormDescription>}
          </div>
        </FormItem>
      )}
    />
  );
}
