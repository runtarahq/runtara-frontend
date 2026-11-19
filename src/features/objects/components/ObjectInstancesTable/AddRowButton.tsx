import { memo, useState } from 'react';

export const AddRowButton = memo(({ onClick }: { onClick: () => void }) => {
  const [isHovering, setIsHovering] = useState(false);

  return (
    <button
      type="button"
      className={`w-full cursor-pointer border-t border-border py-3 text-center transition-colors ${
        isHovering ? 'bg-muted/80' : 'bg-muted/30'
      }`}
      onMouseEnter={() => setIsHovering(true)}
      onMouseLeave={() => setIsHovering(false)}
      onClick={onClick}
    >
      <span
        className={`text-xs font-medium ${
          isHovering ? 'text-foreground' : 'text-muted-foreground'
        }`}
      >
        {isHovering ? '+ Click to add a new row' : '+ Add row'}
      </span>
    </button>
  );
});

AddRowButton.displayName = 'AddRowButton';
