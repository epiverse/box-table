// Shared types for the loader pipeline. Loaders prepare raw bytes; the
// table wiring in main.ts converts them to a library source.

export type FileFormat = 'csv' | 'json' | 'parquet';

export interface PreparedSource {
  bytes: Uint8Array;
  format: FileFormat;
  // Display label for the info bar / cache. NOT used for identity.
  sourceName: string;
}

export type LoadKind = 'file' | 'url' | 'box';
