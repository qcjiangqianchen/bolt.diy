import { atom } from 'nanostores';

/*
 * Intentionally use `any` here — GrapeJS types are complex and not worth re-exporting.
 * The editor instance is accessed via the GrapeJS API directly inside components.
 */

export const visualEditorAtom = atom<any | null>(null);
export const visualEditorHtmlAtom = atom<string>('');
export const visualEditorCssAtom = atom<string>('');

/**
 * True when GrapeJS successfully loaded content from the project's index.html.
 * False when the canvas started blank (no index.html found in WebContainer).
 */
export const visualEditorSyncedAtom = atom<boolean>(false);

/**
 * Incremented by action-runner whenever the LLM writes an HTML or CSS file
 * to the WebContainer. VisualEditor watches this to re-read the file and
 * update the GrapeJS canvas so user edits and LLM edits stay in sync.
 */
export const visualEditorUpdateSignalAtom = atom<number>(0);
