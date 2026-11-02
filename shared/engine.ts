export type EngineMode = "auto" | "system" | "builtin";
export type EngineKind = Exclude<EngineMode, "auto">;
export type EngineAvailability = { available: boolean; version?: string; reason?: string };
export type EngineStatus = {
  mode: EngineMode;
  active?: { kind: EngineKind; version: string };
  system: EngineAvailability;
  builtin: EngineAvailability;
  switching?: boolean;
};
export const engineMode = (value: unknown): value is EngineMode => ["auto", "system", "builtin"].includes(String(value));
