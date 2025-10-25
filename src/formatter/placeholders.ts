import type { ERBRegion, RubyRegion } from "../parser.js";

export const PLACEHOLDER_PREFIX = "__ERB_PLACEHOLDER_";
export const PLACEHOLDER_SUFFIX = "__";

export interface PlaceholderEntry {
  id: number;
  regionIndex: number;
  region: RubyRegion;
  placeholder: string;
}

export interface PlaceholderDocument {
  html: string;
  placeholders: PlaceholderEntry[];
}

export function buildPlaceholderDocument(regions: ERBRegion[]): PlaceholderDocument {
  const placeholders: PlaceholderEntry[] = [];
  const parts: string[] = [];

  regions.forEach((region, index) => {
    if (region.type === "ruby") {
      const id = placeholders.length;
      const placeholder = createPlaceholderToken(id);
      placeholders.push({ id, regionIndex: index, region, placeholder });
      parts.push(placeholder);
    } else if (region.type === "html") {
      parts.push(region.text);
    } else {
      parts.push(region.text);
    }
  });

  return {
    html: parts.join(""),
    placeholders,
  };
}

export function restoreFromPlaceholders(
  documentHtml: string,
  placeholders: PlaceholderEntry[],
): string {
  let result = documentHtml;
  placeholders.forEach((entry) => {
    result = result.replace(entry.placeholder, entry.region.text);
  });
  return result;
}

function createPlaceholderToken(id: number): string {
  return `${PLACEHOLDER_PREFIX}${id}${PLACEHOLDER_SUFFIX}`;
}
