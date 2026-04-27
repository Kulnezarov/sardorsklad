export interface CompatibilityItem {
  id: number;
  brand: string;
  model: string;
}

export interface EngineCode {
  id: number;
  description?: string | null;
  compatibility: CompatibilityItem[];
}
