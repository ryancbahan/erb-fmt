export {
  formatERB,
  DEFAULT_FORMATTER_CONFIG,
  type FormatterConfig,
  type FormatterConfigInput,
  type FormatterResult,
  type FormatterDiagnostic,
  type FormatSegment,
} from "./formatter/index.js";

export {
  buildPlaceholderDocument,
  type PlaceholderDocument,
  type PlaceholderEntry,
} from "./formatter/placeholders.js";

export {
  analyzePlaceholderDocument,
  renderHtmlDocument,
} from "./formatter/htmlDocument.js";

export {
  parseERB,
  type ParsedERB,
  type ERBRegion,
  type RubyRegion,
} from "./parser.js";
