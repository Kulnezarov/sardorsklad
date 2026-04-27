import type { CompatibilityItem, EngineCode } from './engine';

export interface Product {
  id: number;
  name: string;
  sku?: string | null;
  barcode?: string | null;
  brand?: string | null;
  model?: string | null;
  engine_code_id?: number | null;
  engine_code?: EngineCode | null;
  compatibility?: {
    engine_code_compatibility?: CompatibilityItem[];
  };
}
