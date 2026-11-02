export type ProjectMappings = Record<string, string>;
export function mappedCwd(cwd: string, mappings: ProjectMappings): string {
  const visited = new Set<string>(); let path = cwd;
  while (mappings[path]) {
    if (visited.has(path) || visited.size >= 20) throw new Error("项目文件夹映射循环，请在设置中重新指定文件夹");
    visited.add(path); path = mappings[path];
  }
  return path;
}
export function projectMappings(value: unknown): ProjectMappings {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).filter(([from, to]) => typeof to === "string" && from.length <= 4096 && to.length <= 4096 && !from.includes("\0") && !to.includes("\0")));
}
