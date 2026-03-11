/**
 * VisualEditor.client.tsx
 *
 * GrapeJS canvas — runs entirely in the browser.
 * On mount:
 *   1. Reads the current index.html out of the WebContainer filesystem
 *   2. Parses it and loads body HTML + CSS into GrapeJS (non-blank start)
 *   3. On every user edit, writes the updated HTML back to index.html
 *      so the Preview tab auto-refreshes with their changes.
 *
 * Only the canvas is exposed — no style manager, no trait manager, no panels.
 */
import { useEffect, useRef, memo, useState } from 'react';
import { useStore } from '@nanostores/react';
import {
  visualEditorAtom,
  visualEditorHtmlAtom,
  visualEditorCssAtom,
  visualEditorSyncedAtom,
  visualEditorUpdateSignalAtom,
} from '~/lib/stores/visualEditorStore';
import { webcontainer } from '~/lib/webcontainer';
import { workbenchStore } from '~/lib/stores/workbench';

// Our bolt.diy overrides for GrapeJS styling
import '~/lib/styles/grapesjs-overrides.css';

/*
 * ── Block definitions ─────────────────────────────────────────────────────
 * Using inline CSS throughout so blocks work regardless of whether the
 * project has Tailwind or any CSS framework loaded in the canvas iframe.
 */

/*
 * const DROP_ZONE_STYLE =
 *   'min-height:80px;padding:16px;background:rgba(139,92,246,0.04);border:2px dashed rgba(139,92,246,0.25);border-radius:8px;';
 */

const BLOCKS = [
  /*
   * ── Layout — structural containers that define space distribution ────────
   * These are NOT visible elements — they organize space for other blocks.
   */
  {
    id: 'section',
    label: 'Section',
    category: 'Layout',
    content: { type: 'section-container' },
    media: `<svg viewBox="0 0 48 28" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="1" y="1" width="46" height="26" rx="2"/></svg>`,
  },
  {
    id: 'divider',
    label: 'Divider',
    category: 'Layout',
    content: { type: 'custom-divider' },
    media: `<svg viewBox="0 0 48 28" fill="none" stroke="currentColor" stroke-width="1.5"><line x1="4" y1="14" x2="44" y2="14"/></svg>`,
  },
  {
    id: 'spacer',
    label: 'Spacer',
    category: 'Layout',
    content: '<div style="height:64px;width:100%;"></div>',
    media: `<svg viewBox="0 0 48 28" fill="none" stroke="currentColor" stroke-width="1.5"><line x1="24" y1="4" x2="24" y2="24" stroke-dasharray="3 2"/><line x1="8" y1="4" x2="40" y2="4"/><line x1="8" y1="24" x2="40" y2="24"/></svg>`,
  },
  {
    id: 'columns-1',
    label: '1 Column',
    category: 'Layout',
    content: { type: 'flex-row', components: [{ type: 'flex-col' }] },
    media: `<svg viewBox="0 0 48 28" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="2" y="3" width="44" height="22" rx="1"/></svg>`,
  },
  {
    id: 'columns-2-50-50',
    label: '2 Columns',
    category: 'Layout',
    content: {
      type: 'flex-row',
      components: [
        { type: 'flex-col', style: { flex: '1 1 0%' } },
        { type: 'flex-col', style: { flex: '1 1 0%' } },
      ],
    },
    media: `<svg viewBox="0 0 48 28" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="2" y="3" width="21" height="22" rx="1"/><rect x="25" y="3" width="21" height="22" rx="1"/></svg>`,
  },
  {
    id: 'columns-2-25-75',
    label: '2 Columns 25/75',
    category: 'Layout',
    content: {
      type: 'flex-row',
      components: [
        { type: 'flex-col', style: { flex: '1 1 0%' } },
        { type: 'flex-col', style: { flex: '3 1 0%' } },
      ],
    },
    media: `<svg viewBox="0 0 48 28" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="2" y="3" width="10" height="22" rx="1"/><rect x="14" y="3" width="32" height="22" rx="1"/></svg>`,
  },
  {
    id: 'columns-2-75-25',
    label: '2 Columns 75/25',
    category: 'Layout',
    content: {
      type: 'flex-row',
      components: [
        { type: 'flex-col', style: { flex: '3 1 0%' } },
        { type: 'flex-col', style: { flex: '1 1 0%' } },
      ],
    },
    media: `<svg viewBox="0 0 48 28" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="2" y="3" width="32" height="22" rx="1"/><rect x="36" y="3" width="10" height="22" rx="1"/></svg>`,
  },
  {
    id: 'columns-3',
    label: '3 Columns',
    category: 'Layout',
    content: {
      type: 'flex-row',
      components: [
        { type: 'flex-col', style: { flex: '1 1 0%' } },
        { type: 'flex-col', style: { flex: '1 1 0%' } },
        { type: 'flex-col', style: { flex: '1 1 0%' } },
      ],
    },
    media: `<svg viewBox="0 0 48 28" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="2" y="3" width="13" height="22" rx="1"/><rect x="17" y="3" width="14" height="22" rx="1"/><rect x="33" y="3" width="13" height="22" rx="1"/></svg>`,
  },

  // ── Text — content elements that can be placed into layout blocks ────────
  {
    id: 'heading',
    label: 'Heading',
    category: 'Text',
    content:
      '<h1 style="font-size:2.5rem;font-weight:700;margin:0 0 16px;line-height:1.2;width:auto;max-width:100%;">Your Heading</h1>',
    media: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><text x="2" y="18" font-size="14" font-weight="bold" stroke="none" fill="currentColor">H1</text></svg>`,
  },
  {
    id: 'heading-center',
    label: 'Heading (Center)',
    category: 'Text',
    content:
      '<h1 style="font-size:2.5rem;font-weight:700;margin:0 0 16px;line-height:1.2;text-align:center;width:auto;max-width:100%;">Your Heading</h1>',
    media: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><text x="4" y="18" font-size="14" font-weight="bold" stroke="none" fill="currentColor" text-anchor="middle" x="12">H¹</text><line x1="6" y1="20" x2="18" y2="20" stroke-width="1"/></svg>`,
  },
  {
    id: 'subheading',
    label: 'Subheading',
    category: 'Text',
    content:
      '<h2 style="font-size:1.75rem;font-weight:600;margin:0 0 12px;line-height:1.3;width:auto;max-width:100%;">Subheading</h2>',
    media: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><text x="2" y="17" font-size="12" font-weight="bold" stroke="none" fill="currentColor">H2</text></svg>`,
  },
  {
    id: 'text',
    label: 'Paragraph',
    category: 'Text',
    content:
      '<p style="font-size:1rem;line-height:1.7;margin:0 0 16px;color:#374151;width:auto;max-width:100%;">Click to edit this paragraph. Add your content here.</p>',
    media: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 6h16M4 12h16M4 18h10"/></svg>`,
  },
  {
    id: 'text-center',
    label: 'Text (Center)',
    category: 'Text',
    content:
      '<p style="font-size:1rem;line-height:1.7;margin:0 0 16px;color:#374151;text-align:center;width:auto;max-width:100%;">Click to edit this paragraph.</p>',
    media: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 6h16M6 12h12M4 18h16"/></svg>`,
  },
  {
    id: 'button',
    label: 'Button',
    category: 'Text',
    content:
      '<a href="#" style="display:inline-block;padding:12px 28px;background:#7c3aed;color:#fff;border-radius:8px;font-weight:600;font-size:0.95rem;text-decoration:none;cursor:pointer;">Click Me</a>',
    media: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="7" width="20" height="10" rx="3"/><path d="M8 12h8"/></svg>`,
  },
  {
    id: 'button-outline',
    label: 'Button (Outline)',
    category: 'Text',
    content:
      '<a href="#" style="display:inline-block;padding:12px 28px;background:transparent;color:#7c3aed;border:2px solid #7c3aed;border-radius:8px;font-weight:600;font-size:0.95rem;text-decoration:none;cursor:pointer;">Click Me</a>',
    media: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="7" width="20" height="10" rx="3"/></svg>`,
  },
  {
    id: 'button-ghost',
    label: 'Button (Ghost)',
    category: 'Text',
    content:
      '<a href="#" style="display:inline-block;padding:12px 28px;background:transparent;color:#374151;border:1px solid #d1d5db;border-radius:8px;font-weight:600;font-size:0.95rem;text-decoration:none;cursor:pointer;">Click Me</a>',
    media: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="7" width="20" height="10" rx="3" stroke-dasharray="3 2"/></svg>`,
  },
  {
    id: 'button-danger',
    label: 'Button (Danger)',
    category: 'Text',
    content:
      '<a href="#" style="display:inline-block;padding:12px 28px;background:#dc2626;color:#fff;border-radius:8px;font-weight:600;font-size:0.95rem;text-decoration:none;cursor:pointer;">Delete</a>',
    media: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="7" width="20" height="10" rx="3" fill="#dc2626" stroke="#dc2626"/></svg>`,
  },
  {
    id: 'button-large',
    label: 'Button (Large)',
    category: 'Text',
    content:
      '<a href="#" style="display:inline-block;padding:18px 48px;background:#7c3aed;color:#fff;border-radius:12px;font-weight:700;font-size:1.1rem;text-decoration:none;cursor:pointer;letter-spacing:0.02em;">Get Started</a>',
    media: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="1" y="6" width="22" height="12" rx="3"/></svg>`,
  },
  {
    id: 'link',
    label: 'Link',
    category: 'Text',
    content:
      '<a href="https://example.com" target="_self" style="color:#7c3aed;text-decoration:underline;font-weight:500;font-size:1rem;">Link text</a>',
    media: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>`,
  },
  {
    id: 'image',
    label: 'Image',
    category: 'Text',
    content:
      '<img src="https://placehold.co/800x450?text=Image" alt="Image" style="width:480px;max-width:100%;height:auto;border-radius:12px;display:block;"/>',
    media: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>`,
  },
  {
    id: 'video',
    label: 'Video Embed',
    category: 'Text',
    content:
      '<div style="position:relative;padding-bottom:56.25%;height:0;border-radius:12px;overflow:hidden;background:#111;"><iframe style="position:absolute;top:0;left:0;width:100%;height:100%;border:none;" src="https://www.youtube.com/embed/dQw4w9WgXcQ" allowfullscreen></iframe></div>',
    media: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="4" width="20" height="16" rx="2"/><polygon points="10,8 16,12 10,16"/></svg>`,
  },

  /*
   * ── Cards — single cards: drop into Layout columns to control count ─────────
   * Tip: drag a Card into a 2 Columns layout for 2 cards, 3 Columns for 3, etc.
   */
  {
    id: 'card-single',
    label: 'Card',
    category: 'Cards',
    content: `<div style="background:#fff;border-radius:16px;box-shadow:0 4px 20px rgba(0,0,0,0.08);overflow:hidden;width:100%;box-sizing:border-box;">
  <div style="padding:24px;">
    <h3 style="font-size:1.2rem;font-weight:700;margin:0 0 8px;color:#111827;">Card Title</h3>
    <p style="font-size:0.9rem;color:#6b7280;line-height:1.6;margin:0 0 16px;">Card description text goes here. Keep it concise and compelling.</p>
    <a href="#" style="color:#7c3aed;font-weight:600;font-size:0.9rem;text-decoration:none;">Learn more →</a>
  </div>
</div>`,
    media: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="3"/><path d="M3 9h18"/><line x1="9" y1="15" x2="15" y2="15"/></svg>`,
  },
  {
    id: 'card-icon',
    label: 'Icon Card',
    category: 'Cards',
    content: `<div style="background:#fff;border-radius:16px;box-shadow:0 4px 20px rgba(0,0,0,0.08);padding:32px 24px;width:100%;box-sizing:border-box;text-align:center;">
  <div style="width:60px;height:60px;background:#ede9fe;border-radius:16px;margin:0 auto 20px;display:flex;align-items:center;justify-content:center;font-size:1.75rem;">⚡</div>
  <h3 style="font-size:1.1rem;font-weight:700;margin:0 0 10px;color:#111827;">Feature Title</h3>
  <p style="font-size:0.875rem;color:#6b7280;line-height:1.6;margin:0;">Describe the benefit clearly and concisely in one or two sentences.</p>
</div>`,
    media: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="12" cy="10" r="3"/><path d="M9 17h6"/></svg>`,
  },
  {
    id: 'card-testimonial',
    label: 'Quote Card',
    category: 'Cards',
    content: `<div style="background:#fff;border-radius:16px;box-shadow:0 4px 20px rgba(0,0,0,0.08);padding:28px;width:100%;box-sizing:border-box;">
  <p style="font-size:1rem;color:#374151;line-height:1.7;margin:0 0 20px;font-style:italic;">"This product completely changed how we work. Incredible results from day one."</p>
  <div style="display:flex;align-items:center;gap:12px;">
    <div style="width:44px;height:44px;border-radius:50%;background:linear-gradient(135deg,#7c3aed,#4f46e5);flex-shrink:0;"></div>
    <div><strong style="font-size:0.9rem;display:block;color:#111827;">Jane Smith</strong><span style="font-size:0.8rem;color:#9ca3af;">CEO, Acme Corp</span></div>
  </div>
</div>`,
    media: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="3"/><path d="M8 10h2v4H8zM14 10h2v4h-2z"/></svg>`,
  },
  {
    content: `<div style="display:flex;gap:24px;padding:40px 0;">
  <div style="flex:1;background:#fff;border-radius:16px;box-shadow:0 4px 20px rgba(0,0,0,0.08);overflow:hidden;">
    <img src="https://placehold.co/400x220?text=Image" alt="" style="width:100%;display:block;"/>
    <div style="padding:24px;">
      <h3 style="font-size:1.2rem;font-weight:700;margin:0 0 8px;">Card Title</h3>
      <p style="font-size:0.9rem;color:#6b7280;line-height:1.6;margin:0 0 16px;">Card description text goes here. Keep it concise.</p>
      <a href="#" style="color:#7c3aed;font-weight:600;font-size:0.9rem;text-decoration:none;">Learn more →</a>
    </div>
  </div>
  <div style="flex:1;background:#fff;border-radius:16px;box-shadow:0 4px 20px rgba(0,0,0,0.08);overflow:hidden;">
    <img src="https://placehold.co/400x220?text=Image" alt="" style="width:100%;display:block;"/>
    <div style="padding:24px;">
      <h3 style="font-size:1.2rem;font-weight:700;margin:0 0 8px;">Card Title</h3>
      <p style="font-size:0.9rem;color:#6b7280;line-height:1.6;margin:0 0 16px;">Card description text goes here. Keep it concise.</p>
      <a href="#" style="color:#7c3aed;font-weight:600;font-size:0.9rem;text-decoration:none;">Learn more →</a>
    </div>
  </div>
</div>`,
    media: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="4" width="9" height="16" rx="2"/><rect x="13" y="4" width="9" height="16" rx="2"/></svg>`,
  },
  {
    id: 'cards-3',
    label: '3 Cards',
    category: 'Cards',
    content: `<div style="display:flex;gap:20px;padding:40px 0;">
  <div style="flex:1;background:#fff;border-radius:16px;box-shadow:0 4px 20px rgba(0,0,0,0.08);overflow:hidden;">
    <div style="height:140px;background:linear-gradient(135deg,#7c3aed,#4f46e5);display:flex;align-items:center;justify-content:center;">
      <span style="font-size:2.5rem;">⚡</span>
    </div>
    <div style="padding:20px;">
      <h3 style="font-size:1.1rem;font-weight:700;margin:0 0 8px;">Card Title</h3>
      <p style="font-size:0.875rem;color:#6b7280;line-height:1.6;margin:0;">Description text for this card.</p>
    </div>
  </div>
  <div style="flex:1;background:#fff;border-radius:16px;box-shadow:0 4px 20px rgba(0,0,0,0.08);overflow:hidden;">
    <div style="height:140px;background:linear-gradient(135deg,#0ea5e9,#06b6d4);display:flex;align-items:center;justify-content:center;">
      <span style="font-size:2.5rem;">🚀</span>
    </div>
    <div style="padding:20px;">
      <h3 style="font-size:1.1rem;font-weight:700;margin:0 0 8px;">Card Title</h3>
      <p style="font-size:0.875rem;color:#6b7280;line-height:1.6;margin:0;">Description text for this card.</p>
    </div>
  </div>
  <div style="flex:1;background:#fff;border-radius:16px;box-shadow:0 4px 20px rgba(0,0,0,0.08);overflow:hidden;">
    <div style="height:140px;background:linear-gradient(135deg,#f59e0b,#ef4444);display:flex;align-items:center;justify-content:center;">
      <span style="font-size:2.5rem;">🌟</span>
    </div>
    <div style="padding:20px;">
      <h3 style="font-size:1.1rem;font-weight:700;margin:0 0 8px;">Card Title</h3>
      <p style="font-size:0.875rem;color:#6b7280;line-height:1.6;margin:0;">Description text for this card.</p>
    </div>
  </div>
</div>`,
    media: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="1" y="4" width="6" height="16" rx="2"/><rect x="9" y="4" width="6" height="16" rx="2"/><rect x="17" y="4" width="6" height="16" rx="2"/></svg>`,
  },
  {
    id: 'cards-feature',
    label: 'Feature Cards',
    category: 'Cards',
    content: `<div style="display:flex;gap:20px;padding:40px 0;text-align:center;">
  <div style="flex:1;padding:32px 20px;background:#faf5ff;border-radius:16px;border:1px solid #e9d5ff;">
    <div style="width:56px;height:56px;background:#7c3aed;border-radius:16px;margin:0 auto 16px;display:flex;align-items:center;justify-content:center;font-size:1.5rem;">⚡</div>
    <h3 style="font-size:1.1rem;font-weight:700;margin:0 0 8px;color:#1a1a2e;">Feature Title</h3>
    <p style="font-size:0.875rem;color:#6b7280;line-height:1.6;margin:0;">Describe the feature benefit in a concise sentence or two.</p>
  </div>
  <div style="flex:1;padding:32px 20px;background:#faf5ff;border-radius:16px;border:1px solid #e9d5ff;">
    <div style="width:56px;height:56px;background:#4f46e5;border-radius:16px;margin:0 auto 16px;display:flex;align-items:center;justify-content:center;font-size:1.5rem;">🔒</div>
    <h3 style="font-size:1.1rem;font-weight:700;margin:0 0 8px;color:#1a1a2e;">Feature Title</h3>
    <p style="font-size:0.875rem;color:#6b7280;line-height:1.6;margin:0;">Describe the feature benefit in a concise sentence or two.</p>
  </div>
  <div style="flex:1;padding:32px 20px;background:#faf5ff;border-radius:16px;border:1px solid #e9d5ff;">
    <div style="width:56px;height:56px;background:#0ea5e9;border-radius:16px;margin:0 auto 16px;display:flex;align-items:center;justify-content:center;font-size:1.5rem;">🌍</div>
    <h3 style="font-size:1.1rem;font-weight:700;margin:0 0 8px;color:#1a1a2e;">Feature Title</h3>
    <p style="font-size:0.875rem;color:#6b7280;line-height:1.6;margin:0;">Describe the feature benefit in a concise sentence or two.</p>
  </div>
</div>`,
    media: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="1" y="8" width="6" height="13" rx="1"/><rect x="9" y="5" width="6" height="16" rx="1"/><rect x="17" y="2" width="6" height="19" rx="1"/></svg>`,
  },
  {
    id: 'cards-testimonial',
    label: 'Testimonials',
    category: 'Cards',
    content: `<div style="display:flex;gap:20px;padding:40px 0;">
  <div style="flex:1;background:#fff;border-radius:16px;padding:28px;box-shadow:0 4px 20px rgba(0,0,0,0.08);">
    <p style="font-size:1rem;color:#374151;line-height:1.7;margin:0 0 20px;font-style:italic;">"This product completely changed how we work. Incredible results from day one."</p>
    <div style="display:flex;align-items:center;gap:12px;">
      <div style="width:44px;height:44px;border-radius:50%;background:linear-gradient(135deg,#7c3aed,#4f46e5);"></div>
      <div><strong style="font-size:0.9rem;display:block;">Jane Smith</strong><span style="font-size:0.8rem;color:#9ca3af;">CEO, Acme Corp</span></div>
    </div>
  </div>
  <div style="flex:1;background:#fff;border-radius:16px;padding:28px;box-shadow:0 4px 20px rgba(0,0,0,0.08);">
    <p style="font-size:1rem;color:#374151;line-height:1.7;margin:0 0 20px;font-style:italic;">"Seamless experience from start to finish. Our team loves using it every day."</p>
    <div style="display:flex;align-items:center;gap:12px;">
      <div style="width:44px;height:44px;border-radius:50%;background:linear-gradient(135deg,#0ea5e9,#06b6d4);"></div>
      <div><strong style="font-size:0.9rem;display:block;">Mark Lopez</strong><span style="font-size:0.8rem;color:#9ca3af;">CTO, TechFlow</span></div>
    </div>
  </div>
</div>`,
    media: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 21c3 0 7-1 7-8V5c0-1.25-.756-2.017-2-2H4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2 1 0 1 0 1 1v1c0 1-1 2-2 2s-1 .008-1 1.031V20c0 1 0 1 1 1z"/><path d="M15 21c3 0 7-1 7-8V5c0-1.25-.757-2.017-2-2h-4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2h.75c0 2.25.25 4-2.75 4v3c0 1 0 1 1 1z"/></svg>`,
  },
  {
    id: 'cards-pricing',
    label: 'Pricing Tiers',
    category: 'Cards',
    content: `<div style="display:flex;gap:20px;padding:40px 0;align-items:flex-start;">
  <div style="flex:1;border:1px solid #e5e7eb;border-radius:20px;padding:32px 24px;text-align:center;">
    <h3 style="font-size:1.1rem;font-weight:700;margin:0 0 8px;">Starter</h3>
    <div style="font-size:2.5rem;font-weight:800;margin:0 0 4px;">$9<span style="font-size:1rem;font-weight:400;color:#9ca3af;">/mo</span></div>
    <p style="font-size:0.875rem;color:#6b7280;margin:0 0 24px;">Perfect for individuals</p>
    <ul style="list-style:none;padding:0;margin:0 0 28px;text-align:left;font-size:0.875rem;color:#374151;line-height:2;">
      <li>✓ 5 projects</li><li>✓ 10GB storage</li><li>✓ Basic support</li>
    </ul>
    <a href="#" style="display:block;padding:12px;background:#f3f4f6;color:#374151;border-radius:10px;font-weight:600;text-decoration:none;font-size:0.9rem;">Get Started</a>
  </div>
  <div style="flex:1;border:2px solid #7c3aed;border-radius:20px;padding:32px 24px;text-align:center;background:#faf5ff;position:relative;">
    <span style="position:absolute;top:-12px;left:50%;transform:translateX(-50%);background:#7c3aed;color:#fff;font-size:0.75rem;font-weight:700;padding:4px 14px;border-radius:20px;">POPULAR</span>
    <h3 style="font-size:1.1rem;font-weight:700;margin:0 0 8px;">Pro</h3>
    <div style="font-size:2.5rem;font-weight:800;margin:0 0 4px;color:#7c3aed;">$29<span style="font-size:1rem;font-weight:400;color:#9ca3af;">/mo</span></div>
    <p style="font-size:0.875rem;color:#6b7280;margin:0 0 24px;">For growing teams</p>
    <ul style="list-style:none;padding:0;margin:0 0 28px;text-align:left;font-size:0.875rem;color:#374151;line-height:2;">
      <li>✓ Unlimited projects</li><li>✓ 100GB storage</li><li>✓ Priority support</li>
    </ul>
    <a href="#" style="display:block;padding:12px;background:#7c3aed;color:#fff;border-radius:10px;font-weight:600;text-decoration:none;font-size:0.9rem;">Get Started</a>
  </div>
  <div style="flex:1;border:1px solid #e5e7eb;border-radius:20px;padding:32px 24px;text-align:center;">
    <h3 style="font-size:1.1rem;font-weight:700;margin:0 0 8px;">Business</h3>
    <div style="font-size:2.5rem;font-weight:800;margin:0 0 4px;">$79<span style="font-size:1rem;font-weight:400;color:#9ca3af;">/mo</span></div>
    <p style="font-size:0.875rem;color:#6b7280;margin:0 0 24px;">For large organisations</p>
    <ul style="list-style:none;padding:0;margin:0 0 28px;text-align:left;font-size:0.875rem;color:#374151;line-height:2;">
      <li>✓ All Pro features</li><li>✓ 1TB storage</li><li>✓ Dedicated support</li>
    </ul>
    <a href="#" style="display:block;padding:12px;background:#f3f4f6;color:#374151;border-radius:10px;font-weight:600;text-decoration:none;font-size:0.9rem;">Get Started</a>
  </div>
</div>`,
    media: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="1" y="10" width="6" height="11" rx="1"/><rect x="9" y="6" width="6" height="15" rx="1"/><rect x="17" y="3" width="6" height="18" rx="1"/></svg>`,
  },

  // ── Banners — Pre-styled Hero & Banner Sections ────────────────────────────
  {
    id: 'banner-classic-purple',
    label: 'Hero (Purple)',
    category: 'Banners',
    content: `<div style="background:linear-gradient(135deg, #1e1b4b 0%, #4c1d95 100%);padding:100px 24px;text-align:center;color:#fff;width:100%;box-sizing:border-box;">
  <div style="max-width:800px;margin:0 auto;">
    <h1 style="font-size:3.5rem;font-weight:800;margin:0 0 24px;line-height:1.1;letter-spacing:-0.02em;">Your Hero Headline<br/>Here</h1>
    <p style="font-size:1.125rem;color:#c4b5fd;line-height:1.6;margin:0 0 40px;max-width:600px;margin-left:auto;margin-right:auto;">A compelling subheadline that explains your value proposition in one or two sentences.</p>
    <div style="display:flex;gap:16px;justify-content:center;flex-wrap:wrap;">
      <a href="#" style="padding:14px 32px;background:#8b5cf6;color:#fff;border-radius:8px;font-weight:600;text-decoration:none;transition:background 0.2s;">Click Me</a>
      <a href="#" style="padding:14px 32px;background:#fff;color:#4c1d95;border-radius:8px;font-weight:600;text-decoration:none;transition:background 0.2s;">Get Started</a>
      <a href="#" style="padding:14px 32px;background:transparent;color:#fff;border:1px solid rgba(255,255,255,0.3);border-radius:8px;font-weight:600;text-decoration:none;transition:background 0.2s;">Learn More</a>
      <a href="#" style="padding:14px 32px;background:#8b5cf6;color:#fff;border-radius:8px;font-weight:600;text-decoration:none;transition:background 0.2s;">Click Me</a>
    </div>
  </div>
</div>`,
    media: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="5" width="20" height="14" rx="2" fill="#4c1d95" stroke="#4c1d95"/><path d="M6 10h12M8 14h8" stroke="#fff" stroke-linecap="round"/></svg>`,
  },
  {
    id: 'banner-simple-purple',
    label: 'Banner (Purple)',
    category: 'Banners',
    content: `<div style="background:#8b5cf6;padding:64px 24px;text-align:center;color:#fff;width:100%;box-sizing:border-box;">
  <div style="max-width:600px;margin:0 auto;">
    <h2 style="font-size:2.5rem;font-weight:800;margin:0 0 16px;line-height:1.2;letter-spacing:-0.01em;">Ready to Get Started?</h2>
    <p style="font-size:1.125rem;color:#ede9fe;line-height:1.6;margin:0 0 32px;">Join thousands of customers who trust us to power their business. Start your free trial today.</p>
    <a href="#" style="display:inline-block;padding:12px 32px;background:#fff;color:#6d28d9;border-radius:8px;font-weight:600;text-decoration:none;">Start Free Trial</a>
  </div>
</div>`,
    media: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="7" width="20" height="10" rx="2" fill="#8b5cf6" stroke="#8b5cf6"/><circle cx="12" cy="12" r="2" fill="#fff" stroke="none"/></svg>`,
  },
  {
    id: 'banner-navbar',
    label: 'Navbar',
    category: 'Banners',
    content: `<nav style="display:flex;justify-content:space-between;align-items:center;padding:20px 40px;background:#fff;border-bottom:1px solid #e5e7eb;width:100%;box-sizing:border-box;">
  <div style="font-size:1.5rem;font-weight:700;color:#111827;">Website Title</div>
  <div style="display:flex;gap:24px;">
    <a href="#" style="text-decoration:none;color:#4b5563;font-weight:500;">Home</a>
    <a href="#" style="text-decoration:none;color:#4b5563;font-weight:500;">About</a>
    <a href="#" style="text-decoration:none;color:#4b5563;font-weight:500;">Services</a>
    <a href="#" style="text-decoration:none;color:#4b5563;font-weight:500;">Contact</a>
  </div>
</nav>`,
    media: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="4" width="20" height="6" rx="1"/><path d="M6 7h4M14 7h4" stroke-linecap="round"/></svg>`,
  },
  {
    id: 'banner-footer',
    label: 'Footer',
    category: 'Banners',
    content: `<footer style="background:#111827;color:#9ca3af;padding:48px 24px;text-align:center;width:100%;box-sizing:border-box;">
  <div style="max-width:800px;margin:0 auto;display:flex;flex-direction:column;gap:24px;">
    <div style="font-size:1.5rem;font-weight:700;color:#fff;">Website Title</div>
    <div style="display:flex;justify-content:center;gap:24px;flex-wrap:wrap;">
      <a href="#" style="text-decoration:none;color:#9ca3af;">Privacy Policy</a>
      <a href="#" style="text-decoration:none;color:#9ca3af;">Terms of Service</a>
      <a href="#" style="text-decoration:none;color:#9ca3af;">Contact Us</a>
    </div>
    <p style="margin:0;font-size:0.875rem;">&copy; 2024 Website Title. All rights reserved.</p>
  </div>
</footer>`,
    media: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="14" width="20" height="6" rx="1"/><path d="M6 17h12" stroke-linecap="round"/></svg>`,
  },
];

// ── HTML parse helpers ────────────────────────────────────────────────────

/**
 * Extracts the <body> inner HTML and all <style> block contents from a full
 * HTML document string. Falls back gracefully for partial/missing documents.
 */
function parseHtmlDocument(html: string): { bodyHtml: string; cssContent: string } {
  // Extract all <style> content
  const styleMatches = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)];
  const cssContent = styleMatches.map((m) => m[1]).join('\n');

  // Extract <body> inner HTML
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
  const bodyHtml = bodyMatch ? bodyMatch[1].trim() : html;

  return { bodyHtml, cssContent };
}

/**
 * Reconstructs a complete HTML document from GrapeJS canvas output.
 * Preserves the original <head> (including Tailwind link) and replaces
 * the <body> content + <style> block.
 */
function buildHtmlDocument(originalHtml: string, newBodyHtml: string, newCss: string): string {
  // Strip old body content
  let result = originalHtml;

  // Replace or inject <style> in <head>
  if (/<style[^>]*>/i.test(result)) {
    result = result.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
  }

  const styleBlock = newCss ? `\n<style>\n${newCss}\n</style>` : '';

  if (/<\/head>/i.test(result)) {
    result = result.replace('</head>', `${styleBlock}\n</head>`);
  } else if (/<head>/i.test(result)) {
    result = result.replace('</head>', `${styleBlock}\n</head>`);
  }

  // Replace <body> content
  if (/<body[^>]*>/i.test(result)) {
    result = result.replace(/<body([^>]*)>[\s\S]*?<\/body>/i, `<body$1>\n${newBodyHtml}\n</body>`);
  }

  return result;
}

// ── Component ────────────────────────────────────────────────────────────

export const VisualEditor = memo(() => {
  const editorContainerRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<any>(null);
  const originalHtmlRef = useRef<string>('');
  const indexHtmlPathRef = useRef<string>('');
  const [, setLoadStatus] = useState<'loading' | 'loaded-from-file' | 'blank'>('loading');
  const updateSignal = useStore(visualEditorUpdateSignalAtom);
  const isSyncingFromExternalRef = useRef(false);

  // ── Re-read from WebContainer when LLM writes HTML/CSS ──────────────────
  useEffect(() => {
    if (!editorRef.current || !updateSignal) {
      return;
    }

    const editor = editorRef.current;

    webcontainer.then(async (wc) => {
      if (!indexHtmlPathRef.current) {
        return;
      }

      try {
        const content = await wc.fs.readFile(indexHtmlPathRef.current, 'utf-8');

        if (!content) {
          return;
        }

        const { bodyHtml, cssContent: inlineCss } = parseHtmlDocument(content);

        // ── Read linked CSS files (same logic as initial mount) ──
        let linkedCss = '';
        const externalStyleUrls: string[] = [];

        const linkMatches = [
          ...content.matchAll(/<link[^>]+rel=["']stylesheet["'][^>]*href=["']([^"']+)["']/gi),
          ...content.matchAll(/<link[^>]+href=["']([^"']+)["'][^>]*rel=["']stylesheet["']/gi),
        ];
        const hrefs = [...new Set(linkMatches.map((m) => m[1]))];

        for (const href of hrefs) {
          if (href.startsWith('http://') || href.startsWith('https://') || href.startsWith('//')) {
            externalStyleUrls.push(href);
            continue;
          }

          const relativePath = href.replace(/^\//, '');

          try {
            const cssFileContent = await wc.fs.readFile(relativePath, 'utf-8');

            if (cssFileContent) {
              linkedCss += `\n/* ── ${relativePath} ── */\n${cssFileContent}\n`;
            }
          } catch {
            // File not found
          }
        }

        const allCss = [inlineCss, linkedCss].filter(Boolean).join('\n');

        // Guard flag: prevent syncExport from writing back while we update from LLM
        isSyncingFromExternalRef.current = true;

        if (bodyHtml) {
          editor.setComponents(bodyHtml);
        }

        if (allCss) {
          editor.setStyle(allCss);
        }

        // Inject external stylesheet URLs into the GrapeJS canvas <head>
        if (externalStyleUrls.length > 0) {
          const canvasDoc = editor.Canvas.getDocument();

          if (canvasDoc) {
            for (const url of externalStyleUrls) {
              if (!canvasDoc.querySelector(`link[href="${url}"]`)) {
                const link = canvasDoc.createElement('link');
                link.rel = 'stylesheet';
                link.href = url;
                canvasDoc.head.appendChild(link);
              }
            }
          }
        }

        originalHtmlRef.current = content;

        // Release guard after GrapeJS finishes its internal update cycle
        setTimeout(() => {
          isSyncingFromExternalRef.current = false;
        }, 200);
      } catch (err) {
        isSyncingFromExternalRef.current = false;
        console.warn('[VisualEditor] Failed to sync LLM changes into canvas:', err);
      }
    });
  }, [updateSignal]);

  useEffect(() => {
    // Inject GrapeJS stock CSS into the page (if not already present)
    const CSS_ID = 'grapesjs-stock-css';

    if (!document.getElementById(CSS_ID)) {
      const link = document.createElement('link');
      link.id = CSS_ID;
      link.rel = 'stylesheet';
      link.href = 'https://unpkg.com/grapesjs@0.22.14/dist/css/grapes.min.css';
      document.head.appendChild(link);
    }

    // Dynamically import GrapeJS to avoid SSR issues
    import('grapesjs').then(async (gjsModule) => {
      const grapesjs = gjsModule.default;

      if (!editorContainerRef.current || editorRef.current) {
        return;
      }

      /*
       * ── 1. Read index.html directly from WebContainer filesystem ──
       * NOTE: WebContainer fs paths are RELATIVE to the workdir, not absolute.
       * Uses retry logic because VisualEditor may mount before WC has re-mounted
       * the project files (e.g. when opening an existing chat after server restart).
       */
      let existingHtml = '';
      let htmlFilePath = '';

      const candidates = ['index.html', 'public/index.html', 'dist/index.html', 'src/index.html'];
      const MAX_RETRIES = 8;
      const RETRY_DELAY_MS = 750;

      for (let attempt = 0; attempt < MAX_RETRIES && !existingHtml; attempt++) {
        if (attempt > 0) {
          // Wait before retrying so WC has time to mount files
          await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
        }

        try {
          const wc = await webcontainer;

          for (const candidate of candidates) {
            try {
              const content = await wc.fs.readFile(candidate, 'utf-8');

              if (content && content.trim().length > 0) {
                existingHtml = content;
                htmlFilePath = candidate;
                break;
              }
            } catch {
              // File doesn't exist at this path — try next candidate
            }
          }
        } catch (err) {
          console.warn('[VisualEditor] WebContainer not ready yet, attempt', attempt + 1, err);
        }
      }

      originalHtmlRef.current = existingHtml;
      indexHtmlPathRef.current = htmlFilePath;

      const { bodyHtml, cssContent: inlineCss } = existingHtml
        ? parseHtmlDocument(existingHtml)
        : { bodyHtml: '', cssContent: '' };

      /*
       * ── 1b. Read every <link rel="stylesheet"> from WebContainer ──
       * This makes the GrapeJS canvas look IDENTICAL to the preview.
       */
      let linkedCss = '';
      const externalStyleUrls: string[] = [];

      if (existingHtml) {
        // Extract href values from <link rel="stylesheet" href="...">
        const linkMatches = [
          ...existingHtml.matchAll(/<link[^>]+rel=["']stylesheet["'][^>]*href=["']([^"']+)["']/gi),
          ...existingHtml.matchAll(/<link[^>]+href=["']([^"']+)["'][^>]*rel=["']stylesheet["']/gi),
        ];

        // Deduplicate hrefs
        const hrefs = [...new Set(linkMatches.map((m) => m[1]))];

        for (const href of hrefs) {
          // Skip protocol-relative / external URLs — just add to canvas.styles
          if (href.startsWith('http://') || href.startsWith('https://') || href.startsWith('//')) {
            externalStyleUrls.push(href);
            continue;
          }

          // Strip leading slash to get relative WebContainer path
          const relativePath = href.replace(/^\//, '');

          try {
            const wc = await webcontainer;
            const cssFileContent = await wc.fs.readFile(relativePath, 'utf-8');

            if (cssFileContent) {
              linkedCss += `\n/* ── ${relativePath} ── */\n${cssFileContent}\n`;
            }
          } catch {
            // File not found — might be served differently
          }
        }
      }

      // Combined CSS: inline styles from <style> tags + linked .css files
      const allCss = [inlineCss, linkedCss].filter(Boolean).join('\n');

      const containerId = 'gjs-canvas-' + Math.random().toString(36).slice(2);
      editorContainerRef.current.id = containerId;

      const editor = grapesjs.init({
        container: `#${containerId}`,
        height: '100%',
        width: 'auto',
        fromElement: false,

        /*
         * ── Enable native GUI panels (Style/Trait Managers) ──────────────────
         * panels: { defaults: [] }, // Removed to allow default right-panel
         */
        styleManager: {
          sectors: [
            {
              name: 'Dimension',
              open: true,
              buildProps: ['width', 'height', 'padding', 'margin'],
              properties: [
                {
                  type: 'select',
                  property: 'width',
                  name: 'Width',
                  default: '100%',
                  options: [
                    { value: 'auto', name: 'Auto' },
                    { value: '100%', name: '100%' },
                    { value: '50%', name: '50%' },
                    { value: '25%', name: '25%' },
                  ],
                },
                {
                  type: 'select',
                  property: 'height',
                  name: 'Height',
                  default: 'auto',
                  options: [
                    { value: 'auto', name: 'Auto' },
                    { value: '100%', name: '100%' },
                    { value: '50vh', name: 'Half Screen' },
                    { value: '100vh', name: 'Full Screen' },
                  ],
                },
              ],
            },
            {
              name: 'Typography',
              open: false,
              buildProps: [
                'font-family',
                'font-size',
                'color',
                'text-align',
                'font-weight',
                'font-style',
                'text-decoration',
              ],
              properties: [
                {
                  type: 'radio',
                  property: 'text-align',
                  name: 'Alignment',
                  defaults: 'left',
                  options: [
                    { value: 'left', title: 'Left', className: 'i-ph:text-align-left' },
                    { value: 'center', title: 'Center', className: 'i-ph:text-align-center' },
                    { value: 'right', title: 'Right', className: 'i-ph:text-align-right' },
                    { value: 'justify', title: 'Justify', className: 'i-ph:text-align-justify' },
                  ],
                },
                {
                  type: 'radio',
                  property: 'font-weight',
                  name: 'Bold',
                  defaults: '400',
                  options: [
                    { value: '400', title: 'Normal', className: 'i-ph:text-t' },
                    { value: '700', title: 'Bold', className: 'i-ph:text-b' },
                  ],
                },
                {
                  type: 'radio',
                  property: 'font-style',
                  name: 'Italic',
                  defaults: 'normal',
                  options: [
                    { value: 'normal', title: 'Normal', className: 'i-ph:text-t' },
                    { value: 'italic', title: 'Italic', className: 'i-ph:text-italic' },
                  ],
                },
                {
                  type: 'radio',
                  property: 'text-decoration',
                  name: 'Underline',
                  defaults: 'none',
                  options: [
                    { value: 'none', title: 'None', className: 'i-ph:text-t' },
                    { value: 'underline', title: 'Underline', className: 'i-ph:text-underline' },
                    { value: 'line-through', title: 'Strike', className: 'i-ph:text-strikethrough' },
                  ],
                },
              ],
            },
            {
              name: 'Decorations',
              open: false,
              buildProps: ['background-color', 'border-radius', 'border'],
            },
          ],
        },

        // traitManager: { appendTo: '' }, // Removed to allow default properties
        selectorManager: { componentFirst: true },
        storageManager: false,

        // ── Canvas settings ───────────────────────────────────────
        canvas: {
          styles: ['https://cdn.jsdelivr.net/npm/modern-normalize@2/modern-normalize.min.css', ...externalStyleUrls],

          // Removes GrapeJS default body padding and matches the page's own CSS
        },

        // ── Block manager ─────────────────────────────────────────
        blockManager: {
          blocks: [],
        },

        // ── Device manager ────────────────────────────────────────
        deviceManager: {
          devices: [
            { name: 'Desktop', width: '' },
            { name: 'Tablet', width: '768px', widthMedia: '768px' },
            { name: 'Mobile', width: '375px', widthMedia: '480px' },
          ],
        },
      });

      // ── 3. Load existing HTML into canvas ─────────────────────────
      if (bodyHtml) {
        editor.setComponents(bodyHtml);

        if (allCss) {
          editor.setStyle(allCss);
        }

        visualEditorSyncedAtom.set(true);
        setLoadStatus('loaded-from-file');
      } else {
        visualEditorSyncedAtom.set(false);
        setLoadStatus('blank');
      }

      // ── 3.5 Register Custom Component Behaviors ──────────────────────

      // Global resizable config to fix left/top resizing in static flow
      const resizableConfig = {
        keyTop: 'margin-top',
        keyLeft: 'margin-left',
        keyWidth: 'width',
        keyHeight: 'height',
        tl: 1,
        tc: 1,
        tr: 1,
        cl: 1,
        cr: 1,
        bl: 1,
        bc: 1,
        br: 1,
      };

      // Apply fixed resizing behavior to ALL default blocks (like headers, text, cards)
      editor.Components.addType('default', {
        model: {
          defaults: {
            resizable: resizableConfig,
          },
        },
      });

      editor.Components.addType('text', {
        model: {
          defaults: {
            resizable: resizableConfig,
          },
        },
      });

      editor.Components.addType('image', {
        model: {
          defaults: {
            resizable: resizableConfig,
          },
        },
      });

      // 1. SECTION: Full-width container with centred inner container (like GrapeJS)
      editor.Components.addType('section-container', {
        model: {
          defaults: {
            tagName: 'section',
            droppable: true,
            draggable: true,
            resizable: resizableConfig,
            components: [
              {
                type: 'section-inner-container',
              },
            ],
            style: {
              width: '100%',
              padding: '40px 0',
              'box-sizing': 'border-box',
              'min-height': '120px',
            },
          },
        },
      });

      // 1b. SECTION INNER CONTAINER: Centred, max-width child of a section
      editor.Components.addType('section-inner-container', {
        model: {
          defaults: {
            tagName: 'div',
            droppable: true,
            draggable: false, // Only lives inside a section
            style: {
              'max-width': '1200px',
              margin: '0 auto',
              padding: '0 20px',
              'min-height': '80px',
              'box-sizing': 'border-box',
            },
          },
        },
      });

      // 2. FLEX ROW: Horizontal container that holds columns side-by-side
      editor.Components.addType('flex-row', {
        model: {
          defaults: {
            tagName: 'div',
            droppable: true,
            draggable: true,
            resizable: resizableConfig,
            style: {
              display: 'flex',
              'flex-direction': 'row',
              'flex-wrap': 'nowrap',
              'align-items': 'stretch',
              gap: '20px',
              width: '100%',
              'box-sizing': 'border-box',
              'min-height': '100px',
              padding: '16px',
            },
          },
          init() {
            const tr = (this as any).get('toolbar') || [];

            // Define custom alignment buttons
            const alignActions = [
              {
                attributes: { class: 'i-ph:align-left gjs-toolbar-item', title: 'Align Left' },
                command: (ed: any) => {
                  ed.getSelected().addStyle({ 'justify-content': 'flex-start' });
                },
              },
              {
                attributes: { class: 'i-ph:align-center-horizontal gjs-toolbar-item', title: 'Align Center' },
                command: (ed: any) => {
                  ed.getSelected().addStyle({ 'justify-content': 'center' });
                },
              },
              {
                attributes: { class: 'i-ph:align-right gjs-toolbar-item', title: 'Align Right' },
                command: (ed: any) => {
                  ed.getSelected().addStyle({ 'justify-content': 'flex-end' });
                },
              },
            ];

            (this as any).set('toolbar', [...alignActions, ...tr]);
          },
        },
      });

      // 3. FLEX COL: Child of a flex-row that holds droppable content
      editor.Components.addType('flex-col', {
        model: {
          defaults: {
            tagName: 'div',
            droppable: true,
            draggable: true,
            resizable: resizableConfig,
            style: {
              display: 'flex',
              flex: '1 1 0%',
              'flex-direction': 'column',
              gap: '16px',
              'box-sizing': 'border-box',
              'min-height': '100px',
              padding: '16px',
            },
          },
          init() {
            const tr = (this as any).get('toolbar') || [];

            // Define custom vertical alignment buttons (for columns)
            const alignActions = [
              {
                attributes: { class: 'i-ph:align-top gjs-toolbar-item', title: 'Align Top' },
                command: (ed: any) => {
                  ed.getSelected().addStyle({ 'justify-content': 'flex-start' });
                },
              },
              {
                attributes: { class: 'i-ph:align-center-vertical gjs-toolbar-item', title: 'Align Center' },
                command: (ed: any) => {
                  ed.getSelected().addStyle({ 'justify-content': 'center' });
                },
              },
              {
                attributes: { class: 'i-ph:align-bottom gjs-toolbar-item', title: 'Align Bottom' },
                command: (ed: any) => {
                  ed.getSelected().addStyle({ 'justify-content': 'flex-end' });
                },
              },
            ];

            (this as any).set('toolbar', [...alignActions, ...tr]);
          },
        },
      });

      // 4. DIVIDER: Layout spacing margin
      editor.Components.addType('custom-divider', {
        model: {
          defaults: {
            tagName: 'hr',
            droppable: false, // Prevents dropping elements inside the divider
            draggable: true,
            resizable: resizableConfig,
            style: {
              border: 'none',
              'border-top': '1px solid #e5e7eb',
              margin: '32px 0',
              width: '100%',
            },
          },
        },
      });

      // Register blocks
      BLOCKS.forEach((block) => {
        editor.Blocks.add(block.id!, {
          label: block.label,
          category: block.category,
          content: block.content,
          media: block.media,
          attributes: { title: `Drag to add ${block.label}` },
        });
      });

      /*
       * ── Custom hover overlay: fill area with color like GrapeJS ─────────
       * Inject a reusable overlay div into the canvas iframe that we position
       * over the hovered element. This gives the full-area colored highlight.
       * Uses a 150ms debounce to reduce visual noise from rapid mouse movement.
       */
      let hoverTimer: ReturnType<typeof setTimeout> | null = null;

      editor.on('component:hover', (component: any) => {
        // Clear any pending hover timer
        if (hoverTimer) {
          clearTimeout(hoverTimer);
          hoverTimer = null;
        }

        const frame = editor.Canvas.getFrameEl();
        const frameDoc = frame?.contentDocument;

        if (!frameDoc) {
          return;
        }

        // Create or reuse the overlay element (immediately, to avoid flicker on first use)
        let overlay = frameDoc.getElementById('bolt-hover-overlay');

        if (!overlay) {
          overlay = frameDoc.createElement('div');
          overlay.id = 'bolt-hover-overlay';
          overlay.style.cssText = `
            position: absolute;
            pointer-events: none;
            z-index: 9999;
            transition: all 0.08s ease;
            box-sizing: border-box;
          `;
          frameDoc.body.appendChild(overlay);
        }

        if (!component) {
          overlay.style.display = 'none';
          return;
        }

        // Debounce the actual overlay positioning by 120ms
        hoverTimer = setTimeout(() => {
          const el = component.getEl();

          if (!el) {
            overlay!.style.display = 'none';
            return;
          }

          const rect = el.getBoundingClientRect();
          const scrollX = frameDoc.documentElement.scrollLeft || frameDoc.body.scrollLeft;
          const scrollY = frameDoc.documentElement.scrollTop || frameDoc.body.scrollTop;
          const computed = frameDoc.defaultView!.getComputedStyle(el);

          // Get margin values
          const mt = parseFloat(computed.marginTop) || 0;
          const mr = parseFloat(computed.marginRight) || 0;
          const mb = parseFloat(computed.marginBottom) || 0;
          const ml = parseFloat(computed.marginLeft) || 0;

          // Get padding values
          const pt = parseFloat(computed.paddingTop) || 0;
          const pr = parseFloat(computed.paddingRight) || 0;
          const pb = parseFloat(computed.paddingBottom) || 0;
          const pl = parseFloat(computed.paddingLeft) || 0;

          // Overlay covers element+margin area
          overlay!.style.display = 'block';
          overlay!.style.left = `${rect.left + scrollX - ml}px`;
          overlay!.style.top = `${rect.top + scrollY - mt}px`;
          overlay!.style.width = `${rect.width + ml + mr}px`;
          overlay!.style.height = `${rect.height + mt + mb}px`;

          // Orange border = margin area
          overlay!.style.borderTop = `${mt}px solid rgba(246,178,107,0.4)`;
          overlay!.style.borderRight = `${mr}px solid rgba(246,178,107,0.4)`;
          overlay!.style.borderBottom = `${mb}px solid rgba(246,178,107,0.4)`;
          overlay!.style.borderLeft = `${ml}px solid rgba(246,178,107,0.4)`;

          // Green background = padding area
          overlay!.style.background = 'rgba(139,195,74,0.25)';

          // Inner content area (inside padding) — light blue tint
          let contentBox = frameDoc.getElementById('bolt-hover-content');

          if (!contentBox) {
            contentBox = frameDoc.createElement('div');
            contentBox.id = 'bolt-hover-content';
            contentBox.style.cssText = `
              position: absolute;
              pointer-events: none;
              box-sizing: border-box;
            `;
            overlay!.appendChild(contentBox);
          }

          contentBox.style.left = `${pl}px`;
          contentBox.style.top = `${pt}px`;
          contentBox.style.width = `${rect.width - pl - pr}px`;
          contentBox.style.height = `${rect.height - pt - pb}px`;
          contentBox.style.background = 'rgba(100,181,246,0.2)';
        }, 120);
      });

      // Hide overlay when nothing is hovered
      const hideHoverOverlay = () => {
        // Cancel any pending debounce
        if (hoverTimer) {
          clearTimeout(hoverTimer);
          hoverTimer = null;
        }

        const frame = editor.Canvas.getFrameEl();
        const overlay = frame?.contentDocument?.getElementById('bolt-hover-overlay');

        if (overlay) {
          overlay.style.display = 'none';
        }
      };

      editor.on('component:unhover', hideHoverOverlay);

      // Also hide when the canvas frame loads, and inject editor-only CSS
      editor.on('canvas:frame:load', ({ window: frameWindow }: any) => {
        frameWindow?.document?.addEventListener('mouseleave', hideHoverOverlay);

        const frameDoc = frameWindow?.document;

        if (frameDoc && !frameDoc.getElementById('bolt-editor-only-styles')) {
          const style = frameDoc.createElement('style');
          style.id = 'bolt-editor-only-styles';
          style.textContent = `
            /* ── Placeholder labels for EMPTY layout containers ──────────── */
            /* Shared empty-state styling */
            [data-gjs-type="section-container"]:empty::before,
            [data-gjs-type="section-inner-container"]:empty::before,
            [data-gjs-type="flex-row"]:empty::before,
            [data-gjs-type="flex-col"]:empty::before {
              display: flex;
              align-items: center;
              justify-content: center;
              width: 100%;
              height: 100%;
              min-height: inherit;
              font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
              font-size: 13px;
              font-weight: 500;
              letter-spacing: 0.3px;
              pointer-events: none;
              border-radius: 6px;
            }

            [data-gjs-type="section-container"]:empty::before {
              content: '⬜ Section';
              color: rgba(139,92,246,0.5);
              border: 2px dashed rgba(139,92,246,0.2);
              background: rgba(139,92,246,0.03);
            }

            [data-gjs-type="section-inner-container"]:empty::before {
              content: '⬜ Container — Drop content here';
              color: rgba(139,92,246,0.45);
              border: 2px dashed rgba(139,92,246,0.18);
              background: rgba(139,92,246,0.03);
            }

            [data-gjs-type="flex-row"]:empty::before {
              content: '⬜ Row — Drop columns here';
              color: rgba(139,92,246,0.5);
              border: 2px dashed rgba(139,92,246,0.2);
              background: rgba(139,92,246,0.03);
            }

            [data-gjs-type="flex-col"]:empty::before {
              content: '⬜ Column — Drop content here';
              color: rgba(16,185,129,0.55);
              border: 2px dashed rgba(16,185,129,0.2);
              background: rgba(16,185,129,0.03);
            }

            /* ── Inner content outlines for layout children ──────────────── */
            /* Show borders on direct children inside layout containers so
               users can see element boundaries without hovering.             */
            [data-gjs-type="flex-row"] > *,
            [data-gjs-type="flex-col"] > *,
            [data-gjs-type="section-inner-container"] > * {
              outline: 1px dashed rgba(139,92,246,0.18);
              outline-offset: -1px;
            }
          `;
          frameDoc.head.appendChild(style);
        }
      });

      /*
       * ────────────────────────────────────────────────────────────────────
       * Per-component positioning:
       * ─ Content elements: get dmode='absolute' so users can freely
       *   reposition them after the initial (sorter-guided) placement.
       * ─ Sections/layout: no dmode, always snap-to-edge via the sorter.
       * ────────────────────────────────────────────────────────────────────
       */
      const LAYOUT_TYPES = ['section-container', 'section-inner-container', 'flex-row', 'flex-col', 'custom-divider'];

      editor.on('component:add', (component: any) => {
        if (isSyncingFromExternalRef.current) {
          return;
        }

        const type = component.get('type');

        if (type === 'wrapper' || type === 'textnode') {
          return;
        }

        // SECTIONS/LAYOUT: no dmode, no resize → always snap-to-edge
        if (LAYOUT_TYPES.includes(type)) {
          return;
        }

        // CONTENT ELEMENTS: all 8 resize handles (drag corners diagonally)
        if (!component.get('resizable')) {
          component.set('resizable', {
            tl: 1,
            tc: 1,
            tr: 1,
            cl: 1,
            cr: 1,
            bl: 1,
            bc: 1,
            br: 1,
          });
        }
      });

      // ── 4. Sync HTML/CSS on every component change ────────────────
      const syncExport = async () => {
        // Skip if we're currently updating from an external source (LLM write)
        if (isSyncingFromExternalRef.current) {
          return;
        }

        const html = editor.getHtml();
        const css = editor.getCss() ?? '';

        // Update atoms for "Use in Chat"
        visualEditorHtmlAtom.set(html);
        visualEditorCssAtom.set(css);

        // Write changes back to index.html in WebContainer
        if (indexHtmlPathRef.current && originalHtmlRef.current) {
          try {
            const updatedDoc = buildHtmlDocument(originalHtmlRef.current, html, css);

            const wc = await webcontainer;
            await wc.fs.writeFile(indexHtmlPathRef.current, updatedDoc, 'utf-8');

            // Update our reference so subsequent writes use current state
            originalHtmlRef.current = updatedDoc;

            // Trigger Preview iframe reload so it shows the drag-and-drop edits
            workbenchStore.previewsStore.refreshAllPreviews();
          } catch (err) {
            console.warn('[VisualEditor] Could not write back to file:', err);
          }
        }
      };

      editor.on('component:add', syncExport);
      editor.on('component:remove', syncExport);
      editor.on('component:update', syncExport);
      editor.on('component:drag:end', syncExport);

      // Share editor instance globally for BlocksPanel
      visualEditorAtom.set(editor);
      editorRef.current = editor;
    });

    return () => {
      if (editorRef.current) {
        editorRef.current.destroy();
        editorRef.current = null;
        visualEditorAtom.set(null);
        visualEditorSyncedAtom.set(false);
      }
    };
  }, []);

  return (
    <div className="w-full h-full relative overflow-hidden bg-transparent">
      {/* GrapeJS mounts here */}
      <div ref={editorContainerRef} className="w-full h-full" />
    </div>
  );
});

VisualEditor.displayName = 'VisualEditor';
