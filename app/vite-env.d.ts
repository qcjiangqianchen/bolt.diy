declare const __COMMIT_HASH: string;
declare const __APP_VERSION: string;

declare module '*?raw' {
  const content: string;
  export default content;
}

declare module '*?url' {
  const url: string;
  export default url;
}
