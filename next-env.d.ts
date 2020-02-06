/// <reference types="next" />
/// <reference types="next/types/global" />

declare module '*.webp' {
  const data: string;
  export default data;
}

declare module 'simple-icons/icons/*.js' {
  const icon: {
    title: string;
    slug: string;
    hex: string;
    source: string;
    svg: string;
    path: string;
  };
  export default icon;
}
