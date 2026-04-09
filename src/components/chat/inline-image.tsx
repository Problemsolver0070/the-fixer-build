"use client";

import { useState, useMemo, useCallback, useEffect } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

interface InlineImageProps {
  base64: string;
  mediaType: string;
}

export function InlineImage({ base64, mediaType }: InlineImageProps) {
  const [isOpen, setIsOpen] = useState(false);
  const src = useMemo(() => `data:${mediaType};base64,${base64}`, [base64, mediaType]);

  // Close lightbox on Escape key
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setIsOpen(false);
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen]);

  const extension = mediaType.split("/")[1]?.toUpperCase() || "IMG";

  return (
    <>
      {/* Inline thumbnail */}
      <div className="mt-2 group relative inline-block">
        <button
          onClick={() => setIsOpen(true)}
          className="block rounded-lg overflow-hidden border border-border/40 hover:border-border transition-colors"
        >
          <img
            src={src}
            alt="Code execution output"
            className="max-w-full max-h-72 object-contain"
          />
        </button>
        <span className="absolute top-1.5 right-1.5 rounded bg-background/80 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity">
          {extension}
        </span>
      </div>

      {/* Lightbox modal */}
      {isOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm"
          onClick={() => setIsOpen(false)}
        >
          <button
            onClick={() => setIsOpen(false)}
            aria-label="Close"
            className="absolute top-4 right-4 rounded-full bg-background/20 p-2 text-white hover:bg-background/40 transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
          <img
            src={src}
            alt="Code execution output (full size)"
            className={cn(
              "max-w-[90vw] max-h-[90vh] object-contain rounded-lg",
              "shadow-2xl"
            )}
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </>
  );
}
