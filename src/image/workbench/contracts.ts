export type ImageResponsiveMode = "desktop" | "tablet" | "mobile";
export type ImageMobileTab = "images" | "preview" | "settings";

export interface ImageDialogState {
  readonly helpOpen: boolean;
  readonly infoOpen: boolean;
}

export interface ImagePdfCaptureRequestView {
  readonly inputName: string;
  readonly path: string | null;
  readonly pageCount: number;
}
