// Shared types for the loader pipeline. Loaders turn a file, URL or Box
// file into a PreparedSource; main.ts hands it to the library.

import type { SourceOptions } from '@jeyabbalas/data-table';

export type FileFormat = 'csv' | 'json' | 'parquet';

export type LoadKind = 'file' | 'url' | 'box';

export interface PreparedSource {
  /**
   * The dataset, handed to the library unread. As a File it takes the
   * library's File path: Parquet is read from disk as DuckDB loads it, CSV
   * and JSON as text.
   */
  file: File;
  format: FileFormat;
  /** Display label for the status bar and the cache. NOT used for identity. */
  sourceName: string;
  /** How the library reads it, when the defaults would not do. */
  sourceOptions?: SourceOptions;
  /** A workbook's sheet, which this is converted from. */
  sheet?: string;
  /** The size the status bar shows: a workbook's, not its converted sheet's. */
  size?: number;
}
