/**
 * Type shim for grapesjs — the local file: install may not expose its dist/index.d.ts
 * consistently. This minimal declaration is enough to satisfy TypeScript.
 */
declare module 'grapesjs' {
  interface EditorConfig {
    container?: string | HTMLElement;
    height?: string;
    width?: string;
    panels?: { defaults: any[] };
    styleManager?: { sectors: any[] };
    traitManager?: any;
    selectorManager?: any;
    storageManager?: boolean | any;
    canvas?: { styles?: string[]; scripts?: string[] };
    blockManager?: { appendTo?: string; blocks?: any[] };
    deviceManager?: { devices?: any[] };
    [key: string]: any;
  }

  interface Editor {
    Blocks: {
      add(id: string, props: any): any;
      getAll(): { models: any[] };
      render(blocks?: any[], opts?: { external?: boolean }): HTMLElement | undefined;
    };
    getHtml(): string;
    getCss(): string | undefined;
    on(event: string, cb: (...args: any[]) => void): this;
    off(event: string, cb?: (...args: any[]) => void): this;
    destroy(): void;
    [key: string]: any;
  }

  const grapesjs: {
    init(config: EditorConfig): Editor;
    [key: string]: any;
  };

  export default grapesjs;
}
