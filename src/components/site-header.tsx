"use client";

import Link from "next/link";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

function GitHubLogo({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="currentColor"
      focusable="false"
      viewBox="0 0 24 24"
    >
      <path d="M12 .3a12 12 0 0 0-3.8 23.4c.6.1.8-.3.8-.6v-2c-3.3.7-4-1.6-4-1.6-.5-1.3-1.2-1.6-1.2-1.6-1-.7.1-.7.1-.7 1.1.1 1.7 1.2 1.7 1.2 1 1.7 2.6 1.2 3.3.9.1-.7.4-1.2.7-1.5-2.7-.3-5.5-1.3-5.5-5.9 0-1.3.5-2.4 1.2-3.2-.1-.3-.5-1.6.1-3.2 0 0 1-.3 3.3 1.2a11.2 11.2 0 0 1 6 0C17 4.7 18 5 18 5c.7 1.6.3 2.9.1 3.2.8.8 1.2 1.9 1.2 3.2 0 4.6-2.8 5.6-5.5 5.9.4.4.8 1.1.8 2.2v3.3c0 .3.2.7.8.6A12 12 0 0 0 12 .3Z" />
    </svg>
  );
}

export function SiteHeaderActions() {
  return (
    <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
      <Button
        asChild
        variant="outline"
        className="h-10 rounded-md px-2 text-xs sm:px-3 sm:text-sm"
      >
        <a
          href="https://cadskills.xyz"
          target="_blank"
          rel="noreferrer"
          aria-label="Open CAD Skills"
        >
          Skills
        </a>
      </Button>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            asChild
            variant="outline"
            size="icon"
            className="h-10 w-10 rounded-md"
          >
            <a
              href="https://github.com/earthtojake/step.parts"
              target="_blank"
              rel="noreferrer"
              aria-label="Open step.parts on GitHub"
            >
              <GitHubLogo className="size-4" />
            </a>
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom">GitHub</TooltipContent>
      </Tooltip>
      <ThemeToggle />
    </div>
  );
}

export function SiteHeader() {
  return (
    <header className="flex items-start justify-between gap-3 border-b border-border pb-6 sm:gap-4">
      <Link href="/" className="min-w-0 focus:outline-none">
        <p className="text-xs uppercase text-muted-foreground">Open Source CAD Directory</p>
        <div className="mt-2 flex min-w-0 items-center gap-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/favicon.ico"
            alt=""
            width={64}
            height={64}
            aria-hidden="true"
            className="size-8 shrink-0 object-contain pt-0.5 sm:size-11 sm:pt-1"
          />
          <h1 className="min-w-0 text-3xl font-semibold tracking-normal text-foreground transition hover:text-foreground/80 sm:text-5xl">
            step.parts
          </h1>
        </div>
      </Link>
      <SiteHeaderActions />
    </header>
  );
}
