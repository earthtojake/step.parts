"use client";

import { track } from "@vercel/analytics";
import { forwardRef, type ComponentPropsWithoutRef } from "react";

type StepDownloadLinkProps = Omit<ComponentPropsWithoutRef<"a">, "download" | "href"> & {
  href: string;
  fileName: string;
  partId: string;
  partName: string;
  category: string;
  family?: string;
  source: "directory_card" | "part_page";
  byteSize?: number | null;
  standard?: string;
};

export const StepDownloadLink = forwardRef<HTMLAnchorElement, StepDownloadLinkProps>(
  (
    {
      href,
      fileName,
      partId,
      partName,
      category,
      family,
      source,
      byteSize,
      standard,
      onClick,
      children,
      ...props
    },
    ref,
  ) => {
    return (
      <a
        {...props}
        ref={ref}
        href={href}
        download={fileName}
        onClick={(event) => {
          onClick?.(event);

          if (event.defaultPrevented) {
            return;
          }

          track("Step File Download", {
            part_id: partId,
            part_name: partName,
            category,
            file_name: fileName,
            step_url: href,
            source,
            ...(family ? { family } : {}),
            ...(typeof byteSize === "number" ? { byte_size: byteSize } : {}),
            ...(standard ? { standard } : {}),
          });
        }}
      >
        {children}
      </a>
    );
  },
);

StepDownloadLink.displayName = "StepDownloadLink";
