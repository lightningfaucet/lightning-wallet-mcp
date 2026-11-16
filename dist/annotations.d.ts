/**
 * MCP tool annotations (spec 2025-06-18: title, readOnlyHint, destructiveHint, idempotentHint,
 * openWorldHint) for every tool, kept in ONE table so a reviewer can audit them side by side.
 *
 * Policy: read-only lookups are readOnlyHint true. Anything that moves sats, stakes sats, spends
 * sats on a board action, rotates or deletes credentials, or cannot be undone is
 * readOnlyHint false + destructiveHint true. When in doubt a tool is destructive. A tool missing
 * from this table still gets the conservative destructive default, and test/annotations.test.js
 * fails until it is classified.
 */
export interface ToolAnnotations {
    title: string;
    readOnlyHint: boolean;
    destructiveHint: boolean;
    idempotentHint: boolean;
    openWorldHint: boolean;
}
/** R = read-only, D = destructive (money or irreversible), W = additive/overwriting write, not destructive. */
type Kind = 'R' | 'D' | 'W';
/** [kind, idempotent, openWorld] */
type Entry = [Kind, boolean, boolean];
export declare const TOOL_KINDS: Record<string, Entry>;
export declare function toolTitle(name: string): string;
export declare function annotationsFor(name: string): ToolAnnotations;
export declare function withAnnotations<T extends {
    name: string;
}>(defs: T[]): (T & {
    annotations: ToolAnnotations;
})[];
export {};
