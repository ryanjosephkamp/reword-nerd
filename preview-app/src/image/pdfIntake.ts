import type { ImageContainerProvenanceNode, ImageProvenance } from "./contracts";
import {
  MAX_IMAGE_INPUT_BYTES,
  MAX_IMAGE_PDF_PAGES,
  MAX_IMAGE_PIXELS,
  MAX_IMAGE_SESSION_BYTES,
  MAX_IMAGE_SESSION_COUNT,
  ImageIntakeFailure,
  failImageIntake,
  imageIntakeIssue,
  type ExtractedImageCandidate,
  type ExtractedImageCandidateValidator,
  type ImageIntakeIssue,
} from "./intakeContracts";
import {
  prepareImageInput,
  validateImageDimensions,
  validatePreparedImage,
  type ImageDecodeAdapter,
} from "./imageValidation";

const GUARDED_PDFJS_VERSION = "5.4.624";
const GUARDED_PDFJS_BUILD = "384c6208b";
const MAX_PDF_OPERATOR_COUNT = 250_000;
const MAX_PDF_OPERATOR_CHUNK_LENGTH = 1;
const MAX_PDF_CAPTURE_RAW_BYTES = MAX_IMAGE_PIXELS * 4;
const MAX_PDF_DECODE_CUMULATIVE_BYTES = 128 * 1024 * 1024;
const MAX_PDF_IMAGE_SAMPLE_CUMULATIVE_BYTES = MAX_PDF_CAPTURE_RAW_BYTES;
const MAX_PDF_PREDICTOR_ROW_BYTES = 128 * 1024;

let guardedPdfWorkerUrl: string | null = null;

function replaceWorkerContract(source: string, before: string, after: string): string {
  const first = source.indexOf(before);
  if (first < 0 || source.indexOf(before, first + before.length) >= 0) failImageIntake("MALFORMED_PDF");
  return `${source.slice(0, first)}${after}${source.slice(first + before.length)}`;
}

function guardedWorkerSource(workerSource: string): string {
  let source = workerSource;
  source = replaceWorkerContract(
    source,
    "const va=new Uint8Array(0);class DecodeStream extends BaseStream{constructor(e){super();this._rawMinBufferLength=e||0;",
    `const va=new Uint8Array(0);let pdfGuardedDecodeAllocatedBytes=0,pdfGuardedImageSampleAllocatedBytes=0;class DecodeStream extends BaseStream{constructor(e){super();if(e!=null&&(!Number.isSafeInteger(e)||e<0||e>${MAX_PDF_DECODE_CUMULATIVE_BYTES}))throw new Error("PDF decode allocation limit.");this._rawMinBufferLength=e||0;`,
  );
  source = replaceWorkerContract(
    source,
    "ensureBuffer(e){const t=this.buffer;if(e<=t.byteLength)return t;let a=this.minBufferLength;for(;a<e;)a*=2;const r=new Uint8Array(a);r.set(t);return this.buffer=r}",
    `ensureBuffer(e){const t=this.buffer;if(!Number.isSafeInteger(e)||e<0)throw new Error("PDF decode allocation limit.");if(e<=t.byteLength)return t;if(e>${MAX_PDF_DECODE_CUMULATIVE_BYTES})throw new Error("PDF decode allocation limit.");let a=this.minBufferLength;if(!Number.isSafeInteger(a)||a<=0||a>${MAX_PDF_DECODE_CUMULATIVE_BYTES})throw new Error("PDF decode allocation limit.");for(;a<e;)a*=2;if(!Number.isSafeInteger(a)||a<e||a>${MAX_PDF_DECODE_CUMULATIVE_BYTES})throw new Error("PDF decode allocation limit.");const pdfGuardedNextAllocation=pdfGuardedDecodeAllocatedBytes+a;if(!Number.isSafeInteger(pdfGuardedNextAllocation)||pdfGuardedNextAllocation>${MAX_PDF_DECODE_CUMULATIVE_BYTES})throw new Error("PDF decode allocation limit.");const r=new Uint8Array(a);pdfGuardedDecodeAllocatedBytes=pdfGuardedNextAllocation;r.set(t);return this.buffer=r}`,
  );
  source = replaceWorkerContract(
    source,
    "class FlateStream extends DecodeStream{#X=!0;",
    "class FlateStream extends DecodeStream{#X=!1;",
  );
  source = replaceWorkerContract(
    source,
    "async asyncGetBytes(){this.stream.reset();",
    "async asyncGetBytes(){return null;this.stream.reset();",
  );
  source = replaceWorkerContract(
    source,
    "async getTransferableImage(){if(!await JpegStream.canUseImageDecoder)return null;",
    "async getTransferableImage(){return null;if(!await JpegStream.canUseImageDecoder)return null;",
  );
  source = replaceWorkerContract(
    source,
    "const x=e[i++];let k=0,C=0;",
    `const x=e[i++];if(!(Number.isSafeInteger(a.samplesPerLine)&&Number.isSafeInteger(a.scanLines)&&a.samplesPerLine>0&&a.scanLines>0&&a.samplesPerLine<=16384&&a.scanLines<=16384&&a.samplesPerLine*a.scanLines<=${MAX_IMAGE_PIXELS}&&Number.isSafeInteger(x)&&x>=1&&x<=4&&a.samplesPerLine*a.scanLines*x<=${MAX_IMAGE_PIXELS}))throw new Error("PDF JPEG decoded visual limit.");let k=0,C=0;`,
  );
  source = replaceWorkerContract(
    source,
    "const t=e[i],r=e[i+1]>>4,n=15&e[i+1];k<r",
    "const t=e[i],r=e[i+1]>>4,n=15&e[i+1];if(!(Number.isSafeInteger(r)&&Number.isSafeInteger(n)&&r>=1&&r<=4&&n>=1&&n<=4))throw new Error(\"PDF JPEG sampling limit.\");k<r",
  );
  source = replaceWorkerContract(
    source,
    "static async decode(e,{numComponents:t=4,isIndexedColormap:a=!1,smaskInData:r=!1,reducePower:i=0}={}){if(!this.#N){",
    "static async decode(e,{numComponents:t=4,isIndexedColormap:a=!1,smaskInData:r=!1,reducePower:i=0}={}){throw new Error(\"PDF JPX visual unsupported.\");if(!this.#N){",
  );
  source = replaceWorkerContract(
    source,
    "class Jbig2Stream extends DecodeStream{constructor(e,t,a){super(t);",
    "class Jbig2Stream extends DecodeStream{constructor(e,t,a){throw new Error(\"PDF JBIG2 visual unsupported.\");super(t);",
  );
  source = replaceWorkerContract(
    source,
    "class JpxStream extends DecodeStream{constructor(e,t,a){super(t);",
    "class JpxStream extends DecodeStream{constructor(e,t,a){throw new Error(\"PDF JPX visual unsupported.\");super(t);",
  );
  source = replaceWorkerContract(
    source,
    "static async decode(e,t,a,r){if(!this.#N){",
    "static async decode(e,t,a,r){throw new Error(\"PDF JBIG2 visual unsupported.\");if(!this.#N){",
  );
  source = replaceWorkerContract(
    source,
    "class CCITTFaxStream extends DecodeStream{constructor(e,t,a){super(t);this.stream=e;this.dict=e.dict;a instanceof Dict||(a=Dict.empty);const r={next:()=>e.getByte()};",
    `class CCITTFaxStream extends DecodeStream{constructor(e,t,a){super(t);this.stream=e;this.dict=e.dict;a instanceof Dict||(a=Dict.empty);const pdfGuardedColumnsValue=a.get("Columns"),pdfGuardedRowsValue=a.get("Rows"),pdfGuardedColumns=pdfGuardedColumnsValue==null?1728:pdfGuardedColumnsValue,pdfGuardedRows=pdfGuardedRowsValue==null?0:pdfGuardedRowsValue;if(!(Number.isSafeInteger(pdfGuardedColumns)&&pdfGuardedColumns>0&&pdfGuardedColumns<=16384&&Number.isSafeInteger(pdfGuardedRows)&&pdfGuardedRows>=0&&pdfGuardedRows<=16384&&(pdfGuardedRows===0||pdfGuardedColumns*pdfGuardedRows<=${MAX_IMAGE_PIXELS})))throw new Error("PDF CCITT dimensions unsupported.");const r={next:()=>e.getByte()};`,
  );
  source = replaceWorkerContract(
    source,
    "Columns:a.get(\"Columns\"),Rows:a.get(\"Rows\"),",
    "Columns:pdfGuardedColumns,Rows:pdfGuardedRows,",
  );
  source = replaceWorkerContract(
    source,
    "const i=this.colors=a.get(\"Colors\")||1,n=this.bits=a.get(\"BPC\",\"BitsPerComponent\")||8,s=this.columns=a.get(\"Columns\")||1;this.pixBytes=i*n+7>>3;this.rowBytes=s*i*n+7>>3;",
    `const pdfGuardedColorsValue=a.get("Colors"),pdfGuardedBitsValue=a.get("BPC","BitsPerComponent"),pdfGuardedColumnsValue=a.get("Columns"),i=this.colors=pdfGuardedColorsValue==null?1:pdfGuardedColorsValue,n=this.bits=pdfGuardedBitsValue==null?8:pdfGuardedBitsValue,s=this.columns=pdfGuardedColumnsValue==null?1:pdfGuardedColumnsValue,pdfGuardedPredictorSamples=s*i,pdfGuardedPredictorBits=pdfGuardedPredictorSamples*n,pdfGuardedPredictorRowBytes=Math.ceil(pdfGuardedPredictorBits/8);if(!(Number.isSafeInteger(i)&&i>=1&&i<=4&&Number.isSafeInteger(n)&&n>=1&&n<=16&&Number.isSafeInteger(s)&&s>=1&&s<=16384&&Number.isSafeInteger(pdfGuardedPredictorSamples)&&pdfGuardedPredictorSamples<=${MAX_IMAGE_PIXELS}&&Number.isSafeInteger(pdfGuardedPredictorBits)&&Number.isSafeInteger(pdfGuardedPredictorRowBytes)&&pdfGuardedPredictorRowBytes>=1&&pdfGuardedPredictorRowBytes<=${MAX_PDF_PREDICTOR_ROW_BYTES}))throw new Error("PDF Predictor dimensions unsupported.");this.pixBytes=Math.ceil(i*n/8);this.rowBytes=pdfGuardedPredictorRowBytes;`,
  );
  source = replaceWorkerContract(
    source,
    "class PDFImage{constructor({xref:e,res:t,image:a,isInline:r=!1,smask:i=null,mask:n=null,isMask:s=!1,pdfFunctionFactory:o,globalColorSpaceCache:c,localColorSpaceCache:l}){",
    `function pdfGuardedChargeImageSamples(e,t,a,r){if(!(Number.isSafeInteger(e)&&Number.isSafeInteger(t)&&e>0&&t>0&&e<=16384&&t<=16384&&e*t<=${MAX_IMAGE_PIXELS}&&Number.isSafeInteger(a)&&a>=1&&a<=4&&(1===r||2===r||4===r||8===r||16===r)))throw new Error("PDF image sample allocation limit.");const i=e*t*a*(r<=8?1:2),n=pdfGuardedImageSampleAllocatedBytes+i;if(!Number.isSafeInteger(i)||i<1||!Number.isSafeInteger(n)||n>${MAX_PDF_IMAGE_SAMPLE_CUMULATIVE_BYTES})throw new Error("PDF image sample allocation limit.");pdfGuardedImageSampleAllocatedBytes=n}class PDFImage{constructor({xref:e,res:t,image:a,isInline:r=!1,smask:i=null,mask:n=null,isMask:s=!1,pdfFunctionFactory:o,globalColorSpaceCache:c,localColorSpaceCache:l}){`,
  );
  source = replaceWorkerContract(
    source,
    "this.width=f;this.height=g;this.interpolate=",
    `if(!(Number.isSafeInteger(f)&&Number.isSafeInteger(g)&&f>0&&g>0&&f<=16384&&g<=16384&&f*g<=${MAX_IMAGE_PIXELS}))throw new Error("PDF image dimensions unsupported.");this.width=f;this.height=g;this.interpolate=`,
  );
  source = replaceWorkerContract(
    source,
    "}this.decode=h.getArray(\"D\",\"Decode\");",
    `}if(this.imageMask&&1!==this.bpc)throw new Error("PDF image sample allocation limit.");pdfGuardedChargeImageSamples(this.width,this.height,this.imageMask?1:this.numComps,this.bpc);this.decode=h.getArray("D","Decode");`,
  );
  source = replaceWorkerContract(
    source,
    "s=a.getArray(\"D\",\"Decode\"),o=s?.[0]>0,c=(r+7>>3)*i,l=await e.getImageData(c)",
    `s=a.getArray("D","Decode"),o=s?.[0]>0;pdfGuardedChargeImageSamples(r,i,1,1);const c=(r+7>>3)*i,l=await e.getImageData(c)`,
  );
  source = replaceWorkerContract(
    source,
    "}else this.mask=n}static async buildImage",
    `}else this.mask=n;const pdfGuardedDrawWidth=this.drawWidth,pdfGuardedDrawHeight=this.drawHeight;if(!(Number.isSafeInteger(pdfGuardedDrawWidth)&&Number.isSafeInteger(pdfGuardedDrawHeight)&&pdfGuardedDrawWidth>0&&pdfGuardedDrawHeight>0&&pdfGuardedDrawWidth<=16384&&pdfGuardedDrawHeight<=16384&&pdfGuardedDrawWidth*pdfGuardedDrawHeight<=${MAX_IMAGE_PIXELS}))throw new Error("PDF effective image dimensions unsupported.")}static async buildImage`,
  );
  source = replaceWorkerContract(
    source,
    "case\"JPXDecode\":({width:a.width,height:a.height,componentsCount:a.numComps,bitsPerComponent:a.bitsPerComponent}=JpxImage.parseImageProperties(a.stream));",
    "case\"JPXDecode\":throw new Error(\"PDF JPX visual unsupported.\");({width:a.width,height:a.height,componentsCount:a.numComps,bitsPerComponent:a.bitsPerComponent}=JpxImage.parseImageProperties(a.stream));",
  );
  source = replaceWorkerContract(
    source,
    "case\"JBIG2Decode\":a.bitsPerComponent=1;a.numComps=1}",
    "case\"JBIG2Decode\":throw new Error(\"PDF JBIG2 visual unsupported.\");a.bitsPerComponent=1;a.numComps=1}",
  );
  source = replaceWorkerContract(
    source,
    "addOp(e,t){this.optimizer.push(e,t);",
    `addOp(e,t){if(!this._streamSink){if(this.fnArray.length>=${MAX_PDF_OPERATOR_COUNT})throw new Error("PDF sinkless operator limit.");if(e>=83&&e<=89)throw new Error("PDF sinkless visual unsupported.")}this.optimizer.push(e,t);`,
  );
  source = replaceWorkerContract(source, "static CHUNK_SIZE=1e3;", "static CHUNK_SIZE=1;");
  source = replaceWorkerContract(source, "static TIME_SLOT_DURATION_MS=20;", "static TIME_SLOT_DURATION_MS=0;");
  source = replaceWorkerContract(source, "static CHECK_TIME_EVERY=100;", "static CHECK_TIME_EVERY=2;");
  source = replaceWorkerContract(
    source,
    "flush(e=!1,t=null){this.optimizer.flush();",
    "flush(e=!1,t=null){if(this._streamSink&&this._streamSink.desiredSize<=-7)throw new Error(\"PDF operator burst limit.\");this.optimizer.flush();",
  );
  source = replaceWorkerContract(
    source,
    "Promise.all([t,r.ready]).then(function(){try{promiseBody(e,i)}catch(e){i(e)}},i)",
    "Promise.resolve(t).then(function(){return r.ready}).then(function(){try{promiseBody(e,i)}catch(e){i(e)}},i)",
  );
  source = replaceWorkerContract(
    source,
    "async getOperatorList({stream:e,task:t,resources:a,operatorList:r,initialState:i=null,fallbackFontDict:n=null,prevRefs:s=null}){if(e.isAsync){const t=await e.asyncGetBytes();",
    "async getOperatorList({stream:e,task:t,resources:a,operatorList:r,initialState:i=null,fallbackFontDict:n=null,prevRefs:s=null}){if(e.isAsync)throw new Error(\"PDF async content unsupported.\");if(e.isAsync){const t=await e.asyncGetBytes();",
  );
  source = replaceWorkerContract(
    source,
    "async getContentStream(){const e=await this.pdfManager.ensure(this,\"content\");if(e instanceof BaseStream&&!e.isImageStream){if(e.isAsync){const t=await e.asyncGetBytes();",
    "async getContentStream(){const e=await this.pdfManager.ensure(this,\"content\");if(e instanceof BaseStream&&!e.isImageStream&&e.isAsync)throw new Error(\"PDF async content unsupported.\");if(e instanceof BaseStream&&!e.isImageStream){if(e.isAsync){const t=await e.asyncGetBytes();",
  );
  source = replaceWorkerContract(
    source,
    "const r=e[a];r instanceof BaseStream&&r.isAsync&&t.push(",
    "const r=e[a];if(r instanceof BaseStream&&r.isAsync)throw new Error(\"PDF async content unsupported.\");r instanceof BaseStream&&r.isAsync&&t.push(",
  );
  source = replaceWorkerContract(
    source,
    "handleTilingType(e,t,a,r,i,n,s,o){const c=new OperatorList",
    "handleTilingType(e,t,a,r,i,n,s,o){throw new Error(\"PDF tiling pattern unsupported.\");const c=new OperatorList",
  );
  source = replaceWorkerContract(
    source,
    "loadType3Data(e,t,a){if(this.#fe)return this.#fe;",
    "loadType3Data(e,t,a){throw new Error(\"PDF Type3 font unsupported.\");if(this.#fe)return this.#fe;",
  );
  source = replaceWorkerContract(
    source,
    "async buildFormXObject(e,t,a,r,i,n,s,o){const{dict:c}=t,l=lookupMatrix(c.getArray(\"Matrix\"),null),h=lookupNormalRect(c.getArray(\"BBox\"),null);",
    "async buildFormXObject(e,t,a,r,i,n,s,o){const{dict:c}=t;if(c.has(\"Group\"))throw new Error(\"PDF form group unsupported.\");const l=lookupMatrix(c.getArray(\"Matrix\"),null),h=lookupNormalRect(c.getArray(\"BBox\"),null);",
  );
  source = replaceWorkerContract(
    source,
    'u.on("GetOperatorList",function(e,t){const{pageId:r,pageIndex:i}=e;a.getPage(r).then(function(a){',
    'u.on("GetOperatorList",function(e,t){const{pageId:r,pageIndex:i}=e;let pdfGuardedTask=null,pdfGuardedCancelled=!1;const pdfGuardedPreTaskCancel=Promise.withResolvers();t.onCancel=()=>{pdfGuardedCancelled=!0;if(pdfGuardedTask){pdfGuardedTask.terminate();return pdfGuardedTask.finished}return pdfGuardedPreTaskCancel.promise};a.getPage(r).then(function(a){',
  );
  source = replaceWorkerContract(
    source,
    "const r=new WorkerTask(`GetOperatorList: page ${i}`);startWorkerTask(r);const n=",
    "if(pdfGuardedCancelled){pdfGuardedPreTaskCancel.resolve();return}const r=new WorkerTask(`GetOperatorList: page ${i}`);pdfGuardedTask=r;startWorkerTask(r);pdfGuardedPreTaskCancel.resolve();let pdfGuardedFinished=!1;const pdfGuardedFinish=()=>{if(!pdfGuardedFinished){pdfGuardedFinished=!0;finishWorkerTask(r)}};const n=",
  );
  source = replaceWorkerContract(
    source,
    "finishWorkerTask(r);n&&info(`page=${i+1} - getOperatorList:",
    "pdfGuardedFinish();n&&info(`page=${i+1} - getOperatorList:",
  );
  source = replaceWorkerContract(
    source,
    "finishWorkerTask(r);r.terminated||t.error(e)",
    "pdfGuardedFinish();r.terminated||t.error(e)",
  );
  source = replaceWorkerContract(
    source,
    'pdfGuardedFinish();r.terminated||t.error(e)})})});u.on("GetTextContent"',
    'pdfGuardedFinish();r.terminated||t.error(e)})},function(e){pdfGuardedPreTaskCancel.resolve();pdfGuardedCancelled||t.error(e)})});u.on("GetTextContent"',
  );
  source = replaceWorkerContract(
    source,
    "if(-1!==o&&d*f>o){const e=\"Image exceeded maximum allowed size and was removed.\";if(!c)throw new Error(e);warn(e);return}let g;",
    `if(-1!==o&&d*f>o){const e="Image exceeded maximum allowed size and was removed.";if(!c)throw new Error(e);warn(e);return}if(!(Number.isSafeInteger(d)&&Number.isSafeInteger(f)&&d>0&&f>0&&d<=16384&&f<=16384&&d*f<=${MAX_IMAGE_PIXELS}))throw new Error("PDF decoded visual limit.");const pdfGuardedRawBytes=d*f*4;this._pdfGuardedRawBytes=(this._pdfGuardedRawBytes||0)+pdfGuardedRawBytes;if(!Number.isSafeInteger(this._pdfGuardedRawBytes)||this._pdfGuardedRawBytes>${MAX_PDF_CAPTURE_RAW_BYTES})throw new Error("PDF decoded visual limit.");let g;`,
  );
  source = replaceWorkerContract(
    source,
    "S=this.globalImageCache.shouldCache(u,this.pageIndex);if(S){",
    "S=!1;if(S){",
  );
  source = replaceWorkerContract(
    source,
    "PDFImage.buildImage({xref:this.xref",
    "const pdfGuardedImagePromise=PDFImage.buildImage({xref:this.xref",
  );
  source = replaceWorkerContract(
    source,
    "return this._sendImgData(w,null,S)});if(i){",
    "return this._sendImgData(w,null,S)});await pdfGuardedImagePromise;if(i){",
  );
  return source;
}

async function ensureGuardedWorker(
  pdfjs: { readonly version?: string; readonly build?: string },
): Promise<string> {
  if (pdfjs.version !== GUARDED_PDFJS_VERSION || pdfjs.build !== GUARDED_PDFJS_BUILD
    || typeof URL.createObjectURL !== "function") failImageIntake("MALFORMED_PDF");
  const { default: workerSource } = await import("pdfjs-dist/build/pdf.worker.min.mjs?raw");
  guardedPdfWorkerUrl ??= URL.createObjectURL(new Blob(
    [guardedWorkerSource(workerSource)],
    { type: "text/javascript" },
  ));
  return guardedPdfWorkerUrl;
}

export interface ImagePdfRaster {
  readonly width: number;
  readonly height: number;
  readPng(signal?: AbortSignal): Promise<Uint8Array>;
  close(): void;
}

export interface ImagePdfCapture {
  readonly bytes: Uint8Array;
  readonly width: number;
  readonly height: number;
}

export interface ImagePdfPage {
  enumerateEmbeddedRasters(signal?: AbortSignal): AsyncIterable<ImagePdfRaster>;
  renderCapturePng(scale: 2 | 3, signal?: AbortSignal): Promise<ImagePdfCapture>;
  cleanup(): void;
}

export interface ImagePdfDocument {
  readonly numPages: number;
  getPage(pageNumber: number, signal?: AbortSignal): Promise<ImagePdfPage>;
  destroy(): Promise<void> | void;
}

export interface ImagePdfLoadingTask {
  readonly promise: Promise<ImagePdfDocument>;
  destroy(): Promise<void> | void;
}

export interface ImagePdfAdapter {
  load(source: Uint8Array, options: { readonly maxImageSize: number }): ImagePdfLoadingTask;
}

export interface ExtractPdfOptions {
  readonly containerName: string;
  readonly containerHash: string;
  readonly containerPath?: string | null;
  readonly parentContainerChain?: readonly ImageContainerProvenanceNode[];
  readonly adapter?: ImagePdfAdapter;
  readonly decoder: ImageDecodeAdapter;
  readonly hash?: (source: Blob) => Promise<string>;
  readonly capturePages?: readonly number[];
  readonly captureQuality?: "standard" | "high";
  readonly resolveCapture?: (
    context: ImagePdfCaptureContext,
  ) => ImagePdfCaptureChoice | Promise<ImagePdfCaptureChoice>;
  readonly validateCandidate?: ExtractedImageCandidateValidator;
  readonly signal?: AbortSignal;
}

export type ImagePdfCaptureChoice =
  | { readonly mode: "embedded-only" }
  | {
    readonly mode: "embedded-and-pages";
    readonly pages: readonly number[];
    readonly quality: "standard" | "high";
  };

export interface ImagePdfCaptureContext {
  readonly containerName: string;
  readonly containerPath: string | null;
  readonly pageCount: number;
  readonly signal: AbortSignal;
}

export interface PdfImageResult {
  readonly images: readonly ExtractedImageCandidate[];
  readonly issues: readonly ImageIntakeIssue[];
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException("PDF intake cancelled.", "AbortError");
}

function waitForPdfOperation<T>(
  operation: PromiseLike<T>,
  signal?: AbortSignal,
  cancel?: () => void,
): Promise<T> {
  throwIfAborted(signal);
  if (!signal) return Promise.resolve(operation);
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const finish = (complete: (value: T) => void, value: T) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", abort);
      complete(value);
    };
    const fail = (reason: unknown) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", abort);
      reject(reason);
    };
    const abort = () => {
      if (settled) return;
      try { cancel?.(); } catch { /* cancellation remains authoritative */ }
      fail(new DOMException("PDF intake cancelled.", "AbortError"));
    };
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
    Promise.resolve(operation).then(
      (value) => finish(resolve, value),
      fail,
    );
  });
}

function pdfIssueFor(error: unknown): "PDF_PASSWORD_PROTECTED" | "MALFORMED_PDF" {
  const name = typeof error === "object" && error !== null && "name" in error
    ? String((error as { name: unknown }).name)
    : "";
  return name === "PasswordException" ? "PDF_PASSWORD_PROTECTED" : "MALFORMED_PDF";
}

function normalizeCaptureChoice(
  choice: ImagePdfCaptureChoice,
  pageCount: number,
): { readonly pages: readonly number[]; readonly quality: "standard" | "high" } {
  if (choice.mode === "embedded-only") return { pages: Object.freeze([]), quality: "standard" };
  if (choice.mode !== "embedded-and-pages"
    || !Array.isArray(choice.pages)
    || (choice.quality !== "standard" && choice.quality !== "high")
    || choice.pages.some((page) => !Number.isSafeInteger(page) || page < 1 || page > pageCount)) {
    failImageIntake("PDF_CAPTURE_SELECTION_INVALID");
  }
  return Object.freeze({
    pages: Object.freeze(Array.from(new Set(choice.pages)).sort((left, right) => left - right)),
    quality: choice.quality,
  });
}

function pdfContainerChain(options: ExtractPdfOptions, byteCount: number): readonly ImageContainerProvenanceNode[] {
  return Object.freeze([
    ...(options.parentContainerChain ?? []).map((node) => Object.freeze({ ...node })),
    Object.freeze({
      kind: "pdf" as const,
      name: options.containerName,
      sha256: options.containerHash,
      path: options.containerPath ?? null,
      byteCount,
    }),
  ]);
}

function pdfProvenance(
  sourceName: string,
  pageNumber: number,
  containerChain: readonly ImageContainerProvenanceNode[],
): ImageProvenance {
  const innermost = containerChain.at(-1)!;
  return Object.freeze({
    intakeKind: "pdf-extracted",
    sourceName,
    sourcePath: null,
    containerChain,
    containerName: innermost.name,
    containerHash: innermost.sha256,
    containerPath: innermost.path,
    pageNumber,
    relationshipId: null,
  });
}

async function candidateFromPng(
  bytes: Uint8Array,
  sourceName: string,
  pageNumber: number,
  dimensions: { width: number; height: number },
  containerChain: readonly ImageContainerProvenanceNode[],
  options: ExtractPdfOptions,
): Promise<ExtractedImageCandidate> {
  validateImageDimensions(dimensions.width, dimensions.height);
  const prepared = await prepareImageInput({
    name: sourceName,
    type: "image/png",
    size: bytes.byteLength,
    arrayBuffer: async () => bytes.slice().buffer,
  });
  const imageProvenance = pdfProvenance(sourceName, pageNumber, containerChain);
  const validated = options.validateCandidate
    ? await options.validateCandidate(prepared, imageProvenance)
    : Object.freeze({
      ...await validatePreparedImage(prepared, {
        decoder: options.decoder,
        hash: options.hash,
        signal: options.signal,
      }),
      provenance: imageProvenance,
    });
  const custodyWarnings = validated.warnings.map((warning) => warning ===
    "Exact source bytes are preserved and may retain EXIF or location metadata."
    ? "Exact derived PNG bytes are preserved; this is locally rasterized PDF recovery output, not original PDF image-stream bytes."
    : warning);
  const warnings = dimensions.width < 64 || dimensions.height < 64
    ? [...custodyWarnings, "This small PDF visual may be decorative; review its inclusion."]
    : custodyWarnings;
  return Object.freeze({
    ...validated,
    warnings: Object.freeze(warnings),
    provenance: validated.provenance,
  });
}

export async function extractPdfImages(source: Blob, options: ExtractPdfOptions): Promise<PdfImageResult> {
  if (!Number.isSafeInteger(source.size) || source.size < 1 || source.size > MAX_IMAGE_INPUT_BYTES) {
    failImageIntake("INPUT_SIZE_INVALID");
  }
  let sourceBytes: Uint8Array;
  try {
    sourceBytes = new Uint8Array(await waitForPdfOperation(source.arrayBuffer(), options.signal));
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    failImageIntake("READ_FAILED");
  }
  if (sourceBytes.byteLength !== source.size
    || sourceBytes.byteLength < 5
    || new TextDecoder().decode(sourceBytes.subarray(0, 5)) !== "%PDF-") {
    failImageIntake("SIGNATURE_MISMATCH");
  }
  throwIfAborted(options.signal);
  const pdfAdapter = options.adapter ?? await loadBrowserImagePdfAdapter();
  const loadingTask = pdfAdapter.load(sourceBytes, { maxImageSize: MAX_IMAGE_PIXELS });
  let document: ImagePdfDocument | null = null;
  const closeRaster = (raster: ImagePdfRaster) => {
    try { raster.close(); } catch { /* one cleanup owner; never replace the intake status */ }
  };
  try {
    try {
      document = await waitForPdfOperation(loadingTask.promise, options.signal);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") throw error;
      failImageIntake(pdfIssueFor(error));
    }
    throwIfAborted(options.signal);
    if (!Number.isSafeInteger(document.numPages)
      || document.numPages < 1) failImageIntake("MALFORMED_PDF");
    if (document.numPages > MAX_IMAGE_PDF_PAGES) failImageIntake("PDF_PAGE_LIMIT_EXCEEDED");

    let capture = normalizeCaptureChoice(
      options.capturePages && options.capturePages.length > 0
        ? {
          mode: "embedded-and-pages",
          pages: options.capturePages,
          quality: options.captureQuality ?? "standard",
        }
        : { mode: "embedded-only" },
      document.numPages,
    );
    if (options.resolveCapture) {
      try {
        const signal = options.signal ?? new AbortController().signal;
        const choice = await waitForPdfOperation(Promise.resolve(options.resolveCapture({
          containerName: options.containerName,
          containerPath: options.containerPath ?? null,
          pageCount: document.numPages,
          signal,
        })), options.signal);
        throwIfAborted(options.signal);
        capture = normalizeCaptureChoice(choice, document.numPages);
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") throw error;
        if (error instanceof ImageIntakeFailure) throw error;
        failImageIntake("PDF_CAPTURE_SELECTION_INVALID");
      }
    }

    const chain = pdfContainerChain(options, source.size);
    const images: ExtractedImageCandidate[] = [];
    const issues: ImageIntakeIssue[] = [];
    let visualCandidateCount = 0;
    const captures = new Set(capture.pages);
    const captureScale: 2 | 3 = capture.quality === "high" ? 3 : 2;
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      throwIfAborted(options.signal);
      let page: ImagePdfPage;
      try {
        page = await waitForPdfOperation(
          document.getPage(pageNumber, options.signal),
          options.signal,
        );
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") throw error;
        failImageIntake("MALFORMED_PDF");
      }
      try {
        let capturedPage: ImagePdfCapture | null = null;
        if (captures.has(pageNumber)) {
          visualCandidateCount += 1;
          try {
            capturedPage = await waitForPdfOperation(
              page.renderCapturePng(captureScale, options.signal),
              options.signal,
            );
            throwIfAborted(options.signal);
          } catch (error) {
            if (error instanceof DOMException && error.name === "AbortError") throw error;
            issues.push(error instanceof ImageIntakeFailure ? error.issue : imageIntakeIssue("DECODE_FAILED"));
          }
        }

        let rasterIndex = 0;
        try {
          for await (const raster of page.enumerateEmbeddedRasters(options.signal)) {
            rasterIndex += 1;
            visualCandidateCount += 1;
            try {
              validateImageDimensions(raster.width, raster.height);
              throwIfAborted(options.signal);
              const bytes = await waitForPdfOperation(raster.readPng(options.signal), options.signal);
              throwIfAborted(options.signal);
              images.push(await candidateFromPng(
                bytes,
                `pdf-page-${String(pageNumber).padStart(3, "0")}-raster-${String(rasterIndex).padStart(3, "0")}.png`,
                pageNumber,
                raster,
                chain,
                options,
              ));
            } catch (error) {
              if (error instanceof DOMException && error.name === "AbortError") throw error;
              issues.push(error instanceof ImageIntakeFailure ? error.issue : imageIntakeIssue("DECODE_FAILED"));
            } finally {
              closeRaster(raster);
            }
          }
        } catch (error) {
          if (error instanceof DOMException && error.name === "AbortError") throw error;
          if (error instanceof ImageIntakeFailure) throw error;
          failImageIntake("MALFORMED_PDF");
        }

        if (capturedPage) {
          try {
            images.push(await candidateFromPng(
              capturedPage.bytes,
              `pdf-page-${String(pageNumber).padStart(3, "0")}-capture.png`,
              pageNumber,
              capturedPage,
              chain,
              options,
            ));
          } catch (error) {
            if (error instanceof DOMException && error.name === "AbortError") throw error;
            issues.push(error instanceof ImageIntakeFailure ? error.issue : imageIntakeIssue("DECODE_FAILED"));
          }
        }
      } finally {
        try { page.cleanup(); } catch { /* one cleanup owner, no error replacement */ }
      }
    }
    if (visualCandidateCount === 0) failImageIntake("PDF_NO_SUPPORTED_IMAGES");
    return Object.freeze({ images: Object.freeze(images), issues: Object.freeze(issues) });
  } finally {
    if (document) await Promise.resolve(document.destroy()).catch(() => undefined);
    await Promise.resolve(loadingTask.destroy()).catch(() => undefined);
  }
}

interface PdfJsImageObject {
  readonly width: number;
  readonly height: number;
  readonly data?: Uint8Array | Uint8ClampedArray;
  readonly bitmap?: ImageBitmap;
}

interface PdfJsOperatorChunk {
  readonly fnArray: readonly number[];
  readonly argsArray: readonly unknown[][];
  readonly length: number;
  readonly lastChunk: boolean;
  readonly separateAnnots: unknown;
}

interface PdfJsOperatorList {
  fnArray: number[];
  argsArray: unknown[][];
  lastChunk: boolean;
  separateAnnots: unknown;
}

interface PdfJsRenderTaskState {
  operatorListIdx: number | null;
  running: boolean;
  cancelled: boolean;
  operatorListChanged(): void;
}

interface PdfJsIntentState {
  operatorList: PdfJsOperatorList;
  renderTasks: Set<PdfJsRenderTaskState>;
  streamReader?: PdfJsOperatorReader | null;
  displayReadyCapability?: { reject(reason: unknown): void };
  opListReadCapability?: { reject(reason: unknown): void };
}

interface PdfJsOperatorReader {
  read(): Promise<ReadableStreamReadResult<PdfJsOperatorChunk>>;
  cancel(reason: Error): Promise<void>;
  releaseLock(): void;
}

interface PdfJsObjectStore extends Iterable<[string, unknown]> {
  get(id: string, callback?: (value: unknown) => void): unknown;
  delete?(id: string): void;
}

interface PdfJsIntentArgs {
  readonly renderingIntent: number;
  readonly cacheKey: string;
  readonly annotationStorageSerializable: {
    readonly map: unknown;
    readonly transfer?: readonly Transferable[];
  };
  readonly modifiedIds: unknown;
}

interface PdfJsPrivatePage {
  readonly _pageIndex: number;
  readonly _transport: {
    getRenderingIntent(
      intent: "display",
      annotationMode: number,
      printAnnotationStorage: null,
      isEditing: false,
      isOpList?: boolean,
    ): PdfJsIntentArgs;
    readonly messageHandler: {
      sendWithStream(
        action: "GetOperatorList",
        data: Readonly<Record<string, unknown>>,
        strategy: QueuingStrategy<PdfJsOperatorChunk>,
        transfers?: readonly Transferable[],
      ): ReadableStream<PdfJsOperatorChunk>;
    };
  };
  readonly _intentStates?: Map<string, PdfJsIntentState>;
  _pumpOperatorList?: (intent: PdfJsIntentArgs) => void;
  _renderPageChunk?: (chunk: PdfJsOperatorChunk, state: PdfJsIntentState) => void;
  readonly objs: PdfJsObjectStore;
  readonly commonObjs: PdfJsObjectStore;
  getViewport?(options: { readonly scale: 2 | 3 }): { readonly width: number; readonly height: number };
  render?(options: Readonly<Record<string, unknown>>): {
    readonly promise: Promise<void>;
    cancel(): void;
  };
  cleanup(): void;
}

interface PdfJsBudget {
  operatorCount: number;
  rasterCount: number;
  encodedBytes: number;
}

interface PdfJsCaptureResourceBudget {
  readonly idsByStore: WeakMap<PdfJsObjectStore, Set<string>>;
  count: number;
  rawBytes: number;
}

const operatorReaderCancellations = new WeakMap<object, Promise<void>>();

function cancelOperatorReader(reader: PdfJsOperatorReader, reason: string): Promise<void> {
  const existing = operatorReaderCancellations.get(reader);
  if (existing) return existing;
  const cancellation = Promise.resolve(reader.cancel(new Error(reason)));
  operatorReaderCancellations.set(reader, cancellation);
  return cancellation;
}

function validateOperatorChunk(chunk: PdfJsOperatorChunk, budget: PdfJsBudget): void {
  if (!chunk || !Number.isSafeInteger(chunk.length)
    || chunk.length < 0
    || chunk.length > MAX_PDF_OPERATOR_CHUNK_LENGTH
    || !Array.isArray(chunk.fnArray)
    || !Array.isArray(chunk.argsArray)
    || typeof chunk.lastChunk !== "boolean"
    || chunk.fnArray.length !== chunk.length
    || chunk.argsArray.length !== chunk.length) failImageIntake("MALFORMED_PDF");
  budget.operatorCount += chunk.length;
  if (!Number.isSafeInteger(budget.operatorCount)
    || budget.operatorCount > MAX_PDF_OPERATOR_COUNT) failImageIntake("MALFORMED_PDF");
}

function retainRasterBudget(budget: PdfJsBudget, byteCount: number): void {
  budget.rasterCount += 1;
  budget.encodedBytes += byteCount;
  if (budget.rasterCount > MAX_IMAGE_SESSION_COUNT) failImageIntake("SESSION_COUNT_EXCEEDED");
  if (!Number.isSafeInteger(budget.encodedBytes)
    || budget.encodedBytes > MAX_IMAGE_SESSION_BYTES) failImageIntake("SESSION_BYTES_EXCEEDED");
}

function auditCaptureStore(
  objects: PdfJsObjectStore,
  resources: PdfJsCaptureResourceBudget,
): void {
  if (typeof objects[Symbol.iterator] !== "function") failImageIntake("MALFORMED_PDF");
  let ids = resources.idsByStore.get(objects);
  if (!ids) {
    ids = new Set<string>();
    resources.idsByStore.set(objects, ids);
  }
  for (const [id, value] of objects) {
    if (ids.has(id) || !value || typeof value !== "object") continue;
    const image = value as Partial<PdfJsImageObject>;
    if (!Number.isSafeInteger(image.width) || !Number.isSafeInteger(image.height)) continue;
    if (!image.bitmap && !image.data) continue;
    validateImageDimensions(image.width!, image.height!);
    ids.add(id);
    resources.count += 1;
    const estimatedBytes = image.width! * image.height! * 4;
    const retainedBytes = Math.max(estimatedBytes, image.data?.byteLength ?? 0);
    resources.rawBytes += retainedBytes;
    if (resources.count > MAX_IMAGE_SESSION_COUNT) failImageIntake("SESSION_COUNT_EXCEEDED");
    if (!Number.isSafeInteger(resources.rawBytes)
      || resources.rawBytes > MAX_PDF_CAPTURE_RAW_BYTES) failImageIntake("SESSION_BYTES_EXCEEDED");
  }
}

function auditCaptureObjects(
  page: PdfJsPrivatePage,
  resources: PdfJsCaptureResourceBudget,
): void {
  auditCaptureStore(page.objs, resources);
  auditCaptureStore(page.commonObjs, resources);
}

function operatorReader(
  page: PdfJsPrivatePage,
  intent: PdfJsIntentArgs,
  pageId: number,
): PdfJsOperatorReader {
  const stream = page._transport.messageHandler.sendWithStream(
    "GetOperatorList",
    {
      pageId,
      pageIndex: page._pageIndex,
      intent: intent.renderingIntent,
      cacheKey: intent.cacheKey,
      annotationStorage: intent.annotationStorageSerializable.map,
      modifiedIds: intent.modifiedIds,
    },
    { highWaterMark: 1, size: () => 1 },
    intent.annotationStorageSerializable.transfer,
  );
  const reader = stream.getReader();
  if (!reader || typeof reader.read !== "function" || typeof reader.cancel !== "function") {
    failImageIntake("MALFORMED_PDF");
  }
  return reader as PdfJsOperatorReader;
}

async function readOperatorChunk(
  reader: PdfJsOperatorReader,
  signal?: AbortSignal,
): Promise<ReadableStreamReadResult<PdfJsOperatorChunk>> {
  return waitForPdfOperation(
    reader.read(),
    signal,
    () => { void cancelOperatorReader(reader, "PDF operator stream cancelled."); },
  );
}

async function resolvePdfObject(
  objects: PdfJsObjectStore,
  id: string,
  signal?: AbortSignal,
): Promise<PdfJsImageObject | null> {
  try {
    return await waitForPdfOperation(new Promise<PdfJsImageObject>((resolve, reject) => {
      try {
        const current = objects.get(id, (value) => resolve(value as PdfJsImageObject));
        if (current) resolve(current as PdfJsImageObject);
      } catch (error) { reject(error); }
    }), signal);
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    return null;
  }
}

function ownedPdfRaster(bytes: Uint8Array, dimensions: { readonly width: number; readonly height: number }): ImagePdfRaster {
  const owned = bytes.slice();
  return Object.freeze({
    width: dimensions.width,
    height: dimensions.height,
    readPng: async (signal?: AbortSignal) => {
      throwIfAborted(signal);
      return owned.slice();
    },
    close: () => undefined,
  });
}

function createCanvas(width: number, height: number): HTMLCanvasElement {
  validateImageDimensions(width, height);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

async function canvasPng(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(
    (value) => value ? resolve(value) : reject(new Error("Canvas encode failed.")),
    "image/png",
  ));
  return new Uint8Array(await blob.arrayBuffer());
}

function rgbaForPdfImage(image: PdfJsImageObject): Uint8ClampedArray {
  validateImageDimensions(image.width, image.height);
  const pixels = image.width * image.height;
  const data = image.data;
  if (!data || ![pixels, pixels * 3, pixels * 4].includes(data.byteLength)) {
    throw new Error("Unsupported PDF raster buffer.");
  }
  if (data.byteLength === pixels * 4) return new Uint8ClampedArray(Uint8Array.from(data).buffer);
  const rgba = new Uint8ClampedArray(pixels * 4);
  for (let pixel = 0; pixel < pixels; pixel += 1) {
    const input = data.byteLength === pixels ? pixel : pixel * 3;
    const output = pixel * 4;
    rgba[output] = data[input];
    rgba[output + 1] = data.byteLength === pixels ? data[input] : data[input + 1];
    rgba[output + 2] = data.byteLength === pixels ? data[input] : data[input + 2];
    rgba[output + 3] = 255;
  }
  return rgba;
}

async function imageObjectPng(image: PdfJsImageObject): Promise<Uint8Array> {
  validateImageDimensions(image.width, image.height);
  const canvas = createCanvas(image.width, image.height);
  const context = canvas.getContext("2d", { alpha: true });
  if (!context) throw new Error("Canvas unavailable.");
  if (image.bitmap) context.drawImage(image.bitmap, 0, 0, image.width, image.height);
  else {
    const source = rgbaForPdfImage(image);
    const owned = new Uint8ClampedArray(source.byteLength);
    owned.set(source);
    context.putImageData(new ImageData(owned, image.width, image.height), 0, 0);
  }
  return canvasPng(canvas);
}

async function* enumerateGuardedPdfRasters(
  page: PdfJsPrivatePage,
  pageId: number,
  pdfjs: { readonly AnnotationMode: { readonly DISABLE: number }; readonly OPS: Readonly<Record<string, number>> },
  budget: PdfJsBudget,
  resources: PdfJsCaptureResourceBudget,
  signal?: AbortSignal,
): AsyncGenerator<ImagePdfRaster> {
  const intent = page._transport.getRenderingIntent(
    "display",
    pdfjs.AnnotationMode.DISABLE,
    null,
    false,
    true,
  );
  const reader = operatorReader(page, intent, pageId);
  const byId = new Map<string, ImagePdfRaster>();
  const byObject = new WeakMap<object, ImagePdfRaster>();
  const closedBitmaps = new WeakSet<object>();
  let complete = false;
  let sawLastChunk = false;
  try {
    while (true) {
      const result = await readOperatorChunk(reader, signal);
      if (result.done) {
        if (!sawLastChunk) failImageIntake("MALFORMED_PDF");
        complete = true;
        break;
      }
      if (sawLastChunk) failImageIntake("MALFORMED_PDF");
      const chunk = result.value;
      validateOperatorChunk(chunk, budget);
      auditCaptureObjects(page, resources);
      sawLastChunk = chunk.lastChunk;
      for (let index = 0; index < chunk.length; index += 1) {
        throwIfAborted(signal);
        const operation = chunk.fnArray[index];
        if (operation !== pdfjs.OPS.paintImageXObject
          && operation !== pdfjs.OPS.paintInlineImageXObject) continue;
        const args = chunk.argsArray[index] ?? [];
        const id = operation === pdfjs.OPS.paintImageXObject ? String(args[0]) : null;
        const globallyCached = Boolean(id?.startsWith("g_"));
        let retained = id ? byId.get(id) : undefined;
        let image: PdfJsImageObject | null = null;
        if (!retained) {
          image = operation === pdfjs.OPS.paintInlineImageXObject
            ? args[0] as PdfJsImageObject
            : await resolvePdfObject(globallyCached ? page.commonObjs : page.objs, id!, signal);
          auditCaptureObjects(page, resources);
          if (image && typeof image === "object") retained = byObject.get(image);
        }
        if (!retained && image) {
          validateImageDimensions(image.width, image.height);
          const bytes = await waitForPdfOperation(imageObjectPng(image), signal);
          retainRasterBudget(budget, bytes.byteLength);
          retained = ownedPdfRaster(bytes, image);
          if (typeof image === "object") byObject.set(image, retained);
        } else if (retained) {
          retainRasterBudget(budget, (await retained.readPng(signal)).byteLength);
        }
        if (!retained) {
          retainRasterBudget(budget, 0);
          retained = ownedPdfRaster(new Uint8Array(), { width: 0, height: 0 });
        }
        if (id) byId.set(id, retained);
        if (!globallyCached && image?.bitmap && typeof image.bitmap === "object"
          && !closedBitmaps.has(image.bitmap)) {
          closedBitmaps.add(image.bitmap);
          try { image.bitmap.close(); } catch { /* page-owned bitmap is no longer needed after PNG custody */ }
        }
        if (id && !globallyCached) {
          try { page.objs.delete?.(id); } catch { /* page cleanup remains the final owner */ }
        }
        yield retained;
      }
    }
  } finally {
    if (!complete) await cancelOperatorReader(reader, "PDF operator stream closed.").catch(() => undefined);
    try { reader.releaseLock(); } catch { /* stream teardown must not replace the intake result */ }
  }
}

function renderTasksConsumed(state: PdfJsIntentState): boolean {
  if (state.renderTasks.size === 0) return false;
  return Array.from(state.renderTasks).every((task) => task.cancelled
    || (Number.isSafeInteger(task.operatorListIdx)
      && task.operatorListIdx === state.operatorList.argsArray.length
      && !task.running));
}

async function waitForRenderConsumption(state: PdfJsIntentState, signal?: AbortSignal): Promise<void> {
  while (!renderTasksConsumed(state)) {
    throwIfAborted(signal);
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
}

function compactConsumedOperatorList(state: PdfJsIntentState): void {
  state.operatorList.fnArray.length = 0;
  state.operatorList.argsArray.length = 0;
  for (const task of state.renderTasks) task.operatorListIdx = 0;
}

function rejectRenderPump(state: PdfJsIntentState, error: unknown): void {
  state.streamReader = null;
  state.operatorList.lastChunk = true;
  for (const task of state.renderTasks) task.operatorListChanged();
  state.displayReadyCapability?.reject(error);
  state.opListReadCapability?.reject(error);
}

function installGuardedRenderPump(
  page: PdfJsPrivatePage,
  pageId: number,
  budget: PdfJsBudget,
  resources: PdfJsCaptureResourceBudget,
  signal?: AbortSignal,
): {
    readonly restore: () => void;
    readonly completion: Promise<void>;
    readonly cancel: () => Promise<void>;
  } {
  if (!page._intentStates || typeof page._pumpOperatorList !== "function"
    || typeof page._renderPageChunk !== "function") failImageIntake("MALFORMED_PDF");
  const original = page._pumpOperatorList;
  let resolvePump!: () => void;
  let rejectPump!: (reason: unknown) => void;
  const completion = new Promise<void>((resolve, reject) => {
    resolvePump = resolve;
    rejectPump = reject;
  });
  let activeReader: PdfJsOperatorReader | null = null;
  page._pumpOperatorList = (intent) => {
    const state = page._intentStates!.get(intent.cacheKey);
    if (!state) throw new Error("PDF render state unavailable.");
    const reader = operatorReader(page, intent, pageId);
    activeReader = reader;
    state.streamReader = reader;
    void (async () => {
      let complete = false;
      let sawLastChunk = false;
      try {
        while (true) {
          const result = await readOperatorChunk(reader, signal);
          if (result.done) {
            if (!sawLastChunk) failImageIntake("MALFORMED_PDF");
            complete = true;
            state.streamReader = null;
            activeReader = null;
            resolvePump();
            break;
          }
          if (sawLastChunk) failImageIntake("MALFORMED_PDF");
          validateOperatorChunk(result.value, budget);
          sawLastChunk = result.value.lastChunk;
          auditCaptureObjects(page, resources);
          page._renderPageChunk!(result.value, state);
          if (!result.value.lastChunk) {
            await waitForRenderConsumption(state, signal);
            auditCaptureObjects(page, resources);
            compactConsumedOperatorList(state);
          }
        }
      } catch (error) {
        rejectPump(error);
        rejectRenderPump(state, error);
        if (!complete) await cancelOperatorReader(reader, "PDF render operator stream failed.").catch(() => undefined);
      } finally {
        try { reader.releaseLock(); } catch { /* render teardown remains authoritative */ }
      }
    })();
  };
  return Object.freeze({
    restore: () => { page._pumpOperatorList = original; },
    completion,
    cancel: () => {
      if (activeReader) return cancelOperatorReader(
        activeReader,
        "PDF render operator stream cancelled.",
      );
      return Promise.resolve();
    },
  });
}

function passwordError(): Error {
  return Object.assign(new Error("Password-protected PDF"), { name: "PasswordException" });
}

export async function loadBrowserImagePdfAdapter(): Promise<ImagePdfAdapter> {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = await ensureGuardedWorker(pdfjs);
  return {
    load(source, options) {
      const budget: PdfJsBudget = { operatorCount: 0, rasterCount: 0, encodedBytes: 0 };
      const captureResources: PdfJsCaptureResourceBudget = {
        idsByStore: new WeakMap(),
        count: 0,
        rawBytes: 0,
      };
      const loadingTask = pdfjs.getDocument({
        data: source.slice(),
        maxImageSize: options.maxImageSize,
        stopAtErrors: true,
        isEvalSupported: false,
        disableFontFace: true,
        enableXfa: false,
      });
      let rejectPassword!: (reason: unknown) => void;
      const password = new Promise<never>((_resolve, reject) => { rejectPassword = reject; });
      loadingTask.onPassword = () => rejectPassword(passwordError());
      return {
        promise: Promise.race([loadingTask.promise, password]).then((pdf): ImagePdfDocument => ({
          numPages: pdf.numPages,
          async getPage(pageNumber, signal) {
            const page = await waitForPdfOperation(pdf.getPage(pageNumber), signal) as unknown as PdfJsPrivatePage;
            if (!page || !Number.isSafeInteger(page._pageIndex)
              || !page._transport
              || typeof page._transport.getRenderingIntent !== "function"
              || typeof page._transport.messageHandler?.sendWithStream !== "function"
              || !page.objs
              || typeof page.objs.get !== "function"
              || !page.commonObjs
              || typeof page.commonObjs.get !== "function") failImageIntake("MALFORMED_PDF");
            const pageId = pdfjs.PagesMapper.instance.getPageId(page._pageIndex + 1) - 1;
            if (!Number.isSafeInteger(pageId) || pageId !== page._pageIndex) failImageIntake("MALFORMED_PDF");
            return {
              enumerateEmbeddedRasters(signal) {
                return enumerateGuardedPdfRasters(
                  page,
                  pageId,
                  pdfjs,
                  budget,
                  captureResources,
                  signal,
                );
              },
              async renderCapturePng(scale, signal) {
                throwIfAborted(signal);
                if (typeof page.getViewport !== "function" || typeof page.render !== "function") {
                  failImageIntake("MALFORMED_PDF");
                }
                const viewport = page.getViewport({ scale });
                const width = Math.ceil(viewport.width);
                const height = Math.ceil(viewport.height);
                validateImageDimensions(width, height);
                const canvas = createCanvas(width, height);
                const canvasContext = canvas.getContext("2d", { alpha: false });
                if (!canvasContext) throw new Error("Canvas unavailable.");
                const guardedPump = installGuardedRenderPump(
                  page,
                  pageId,
                  budget,
                  captureResources,
                  signal,
                );
                let renderTask: ReturnType<NonNullable<PdfJsPrivatePage["render"]>> | null = null;
                let renderCancelled = false;
                let captureComplete = false;
                const cancelRender = () => {
                  if (renderTask && !renderCancelled) {
                    renderCancelled = true;
                    renderTask.cancel();
                  }
                };
                try {
                  renderTask = page.render({
                    canvas,
                    canvasContext,
                    viewport,
                    annotationMode: pdfjs.AnnotationMode.DISABLE,
                  });
                  await waitForPdfOperation(
                    Promise.all([renderTask.promise, guardedPump.completion]),
                    signal,
                    () => {
                      cancelRender();
                      void guardedPump.cancel();
                    },
                  );
                  auditCaptureObjects(page, captureResources);
                  const bytes = await waitForPdfOperation(canvasPng(canvas), signal);
                  retainRasterBudget(budget, bytes.byteLength);
                  try { page.cleanup(); } catch { /* enumeration can rebuild page-owned visual state */ }
                  captureComplete = true;
                  return { bytes, width, height };
                } catch (error) {
                  cancelRender();
                  await guardedPump.cancel().catch(() => undefined);
                  throw error;
                } finally {
                  guardedPump.restore();
                  if (!captureComplete) {
                    cancelRender();
                    await guardedPump.cancel().catch(() => undefined);
                    try { page.cleanup(); } catch { /* guarded failure still owns page cleanup */ }
                  }
                }
              },
              cleanup: () => page.cleanup(),
            };
          },
          destroy: () => pdf.destroy(),
        })),
        destroy: () => loadingTask.destroy(),
      };
    },
  };
}
