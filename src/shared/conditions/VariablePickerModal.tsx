import { useState, useMemo } from 'react';
import { Input } from '@/shared/components/ui/input';
import { SectionLabel } from '@/shared/components/section-label';
import {
  PICKER_DIALOG_WIDTH,
  PICKER_LIST_MAX_HEIGHT,
} from '@/shared/components/picker-dialog';
import {
  PickerEmpty,
  PickerItem,
  PickerTypeChip,
} from '@/shared/components/picker-item';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/shared/components/ui/dialog';
import { Search, Inbox } from 'lucide-react';
import {
  VariableSuggestion,
  filterSuggestions,
  groupSuggestions,
} from './suggestions';

// Variable Picker Modal for reference selection
export const ConditionVariablePickerModal = ({
  open,
  onOpenChange,
  onSelect,
  suggestions,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (variable: VariableSuggestion) => void;
  suggestions: VariableSuggestion[];
}) => {
  const [searchQuery, setSearchQuery] = useState('');

  const allSuggestions = suggestions;

  const filteredSuggestions = useMemo(
    () => filterSuggestions(allSuggestions, searchQuery),
    [allSuggestions, searchQuery]
  );

  const groupedSuggestions = useMemo(
    () => groupSuggestions(filteredSuggestions),
    [filteredSuggestions]
  );

  const handleSelect = (suggestion: VariableSuggestion) => {
    onSelect(suggestion);
    onOpenChange(false);
    setSearchQuery('');
  };

  const handleOpenChange = (newOpen: boolean) => {
    onOpenChange(newOpen);
    if (!newOpen) {
      setSearchQuery('');
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className={PICKER_DIALOG_WIDTH}>
        <DialogHeader>
          <DialogTitle>Select Variable</DialogTitle>
          <DialogDescription>
            Choose a variable from workflow inputs or previous step outputs
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Search input */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search variables..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9 font-mono text-sm"
              autoFocus
            />
          </div>

          {/* Variable list */}
          <div
            className={`${PICKER_LIST_MAX_HEIGHT} space-y-4 overflow-y-auto`}
          >
            {/* Free-text path entry: any legal reference path can be used
                even when it is not in the suggestion list */}
            {searchQuery.trim() !== '' &&
              !allSuggestions.some(
                (suggestion) => suggestion.value === searchQuery.trim()
              ) && (
                <PickerItem
                  className="border border-dashed"
                  onSelect={() =>
                    handleSelect({
                      label: searchQuery.trim(),
                      value: searchQuery.trim(),
                      group: 'Workflow Inputs',
                    })
                  }
                  label={
                    <>
                      <p className="truncate font-mono text-sm">
                        {searchQuery.trim()}
                      </p>
                      <p className="truncate text-xs opacity-70">
                        Use as custom reference path
                      </p>
                    </>
                  }
                />
              )}
            {filteredSuggestions.length === 0 ? (
              <PickerEmpty>
                <Inbox className="mx-auto mb-2 size-8 opacity-50" />
                <p>No matching variables</p>
              </PickerEmpty>
            ) : (
              <>
                {[...groupedSuggestions.entries()].map(
                  ([group, groupSuggestionsList]) =>
                    groupSuggestionsList.length > 0 && (
                      <div key={group}>
                        <SectionLabel as="h4" className="mb-2">
                          {group}
                        </SectionLabel>
                        <div className="space-y-0.5">
                          {groupSuggestionsList.map((suggestion) => (
                            <PickerItem
                              key={suggestion.value}
                              className="overflow-hidden"
                              onSelect={() => handleSelect(suggestion)}
                              label={
                                <>
                                  {suggestion.stepName ? (
                                    <p className="truncate text-sm">
                                      <span className="font-medium">
                                        {suggestion.stepName}
                                      </span>
                                      {suggestion.label && (
                                        <span className="text-muted-foreground">
                                          {' → '}
                                          <span className="font-mono">
                                            {suggestion.label}
                                          </span>
                                        </span>
                                      )}
                                    </p>
                                  ) : (
                                    <p className="truncate font-mono text-sm">
                                      {suggestion.label}
                                    </p>
                                  )}
                                  {suggestion.description && (
                                    <p className="truncate text-xs opacity-70">
                                      {suggestion.description}
                                    </p>
                                  )}
                                </>
                              }
                              typeChip={
                                suggestion.type && (
                                  <PickerTypeChip>
                                    {suggestion.type}
                                  </PickerTypeChip>
                                )
                              }
                            />
                          ))}
                        </div>
                      </div>
                    )
                )}
              </>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};
