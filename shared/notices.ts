export type HiddenNotice = { id: string; plugin: string; pattern: string; builtin?: boolean };
export type NoticePreferences = { hidden: HiddenNotice[] };
