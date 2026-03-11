import React, { useState } from 'react';
import type { Message } from 'ai';

interface TemplateOption {
  id: string;
  title: string;
  image?: string;
  description?: string;
}

interface TemplateSelectorProps {
  templates: TemplateOption[];
  append?: (message: Message) => void;
}

export const TemplateSelector: React.FC<TemplateSelectorProps> = ({ templates, append }) => {
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const handleSelect = (template: TemplateOption) => {
    if (selectedId) {
      return;
    } // Prevent double clicking

    setSelectedId(template.id);

    // Simulate a slight delay for better UX before sending the message
    setTimeout(() => {
      if (append) {
        append({
          id: `template-selection-${Date.now()}`,
          content: `I have selected the "${template.title}" template (${template.id}). Please build the application using this template design.`,
          role: 'user',
        } as Message);
      }
    }, 500);
  };

  if (!templates || templates.length === 0) {
    return null;
  }

  return (
    <div className="my-4 p-4 bg-bolt-elements-background-depth-2 border border-bolt-elements-borderColor rounded-xl shadow-sm">
      <div className="mb-4 text-center">
        <h3 className="text-lg font-semibold text-bolt-elements-textPrimary mb-1">Choose a Design Template</h3>
        <p className="text-sm text-bolt-elements-textSecondary">Select a starting point for your application</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {templates.map((template) => {
          const isSelected = selectedId === template.id;
          const isDimmed = selectedId !== null && !isSelected;

          return (
            <button
              key={template.id}
              onClick={() => handleSelect(template)}
              disabled={selectedId !== null}
              className={`
                relative text-left w-full rounded-xl overflow-hidden border-2 transition-all duration-300
                ${isSelected ? 'border-purple-500 scale-[1.02] shadow-md z-10' : 'border-transparent hover:border-bolt-elements-borderColor hover:shadow-sm'}
                ${isDimmed ? 'opacity-50 grayscale select-none' : ''}
                ${selectedId === null ? 'cursor-pointer' : 'cursor-default'}
                bg-bolt-elements-background-depth-3
              `}
            >
              {/* Image Container */}
              <div className="aspect-video w-full bg-bolt-elements-background-depth-1 relative overflow-hidden flex items-center justify-center border-b border-bolt-elements-borderColor/50">
                {template.image ? (
                  <img
                    src={template.image}
                    alt={template.title}
                    className="w-full h-full object-cover"
                    loading="lazy"
                  />
                ) : (
                  <div className="text-bolt-elements-iconBase text-4xl i-ph:layout opacity-50"></div>
                )}

                {/* Selection Overlay */}
                {isSelected && (
                  <div className="absolute inset-0 bg-purple-500/20 flex items-center justify-center backdrop-blur-[1px]">
                    <div className="bg-purple-500 text-white p-2 rounded-full shadow-lg transform mt-8 animate-bounce">
                      <div className="i-ph:check-bold text-xl"></div>
                    </div>
                  </div>
                )}
              </div>

              {/* Content Container */}
              <div className="p-4">
                <h4 className="font-semibold text-bolt-elements-textPrimary text-base mb-1 truncate">
                  {template.title}
                </h4>
                {template.description && (
                  <p className="text-xs text-bolt-elements-textSecondary line-clamp-2">{template.description}</p>
                )}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
};
