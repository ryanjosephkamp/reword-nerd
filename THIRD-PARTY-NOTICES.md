# Third-party notices

reword_nerd's own code is MIT licensed; see [LICENSE](LICENSE). The site and the app include
the software and data below. The built site also serves `third-party-licenses.txt`, which
repeats this file and adds the license text of every package the build bundles, with their
dependencies.

## Font

- **Newsreader**, by Production Type, under the SIL Open Font License 1.1: "Copyright 2020 The
  Newsreader Project Authors." Served to the browser and embedded in exported documents.
  https://github.com/productiontype/Newsreader/blob/master/OFL.txt

## Reading files

- **PDF.js** (`pdfjs-dist`), Mozilla, Apache License 2.0. https://github.com/mozilla/pdf.js
  The fonts and decoders PDF.js loads at run time (Foxit and Liberation fonts, and the
  JBIG2, OpenJPEG, and QCMS decoders) are served with their own license files beside them,
  in `pdfjs/standard_fonts/` and `pdfjs/wasm/`.
- **Tesseract.js** and **tesseract.js-core**, Apache License 2.0.
  https://github.com/naptha/tesseract.js
- **English OCR data** (`@tesseract.js-data/eng`), from Tesseract's `tessdata`, Apache License
  2.0. https://github.com/tesseract-ocr/tessdata
- **mammoth** (Word documents), BSD 2-Clause. https://github.com/mwilliamson/mammoth.js
- **zip.js**, BSD 3-Clause. https://github.com/gildas-lormeau/zip.js

## Writing and showing text

- **docx**, MIT. https://github.com/dolanmiu/docx
- **diff** (jsdiff), BSD 3-Clause. https://github.com/kpdecker/jsdiff
- **DOMPurify**, MPL 2.0 or Apache License 2.0. https://github.com/cure53/DOMPurify
- **marked**, MIT. https://github.com/markedjs/marked
- **turndown**, MIT. https://github.com/mixmark-io/turndown
- **turndown-plugin-gfm**, MIT. https://github.com/domchristie/turndown-plugin-gfm
- **ignore**, MIT. https://github.com/kaelzhang/node-ignore
- **Phosphor Icons**, MIT. https://github.com/phosphor-icons/react
- **React** and **React DOM**, MIT. https://github.com/facebook/react
- **zustand**, MIT. https://github.com/pmndrs/zustand

## Libraries inside the OCR engine

tesseract.js-core is Tesseract compiled to WebAssembly together with the libraries below. Their
notices follow, as their licenses ask of a binary copy.

### Leptonica

https://github.com/DanBloomberg/leptonica

```text
Copyright (C) 2001-2020 Leptonica.  All rights reserved.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions
are met:
1. Redistributions of source code must retain the above copyright
   notice, this list of conditions and the following disclaimer.
2. Redistributions in binary form must reproduce the above
   copyright notice, this list of conditions and the following
   disclaimer in the documentation and/or other materials
   provided with the distribution.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS
``AS IS'' AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT
LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR
A PARTICULAR PURPOSE ARE DISCLAIMED.  IN NO EVENT SHALL ANY
CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL,
EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO,
PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR
PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY
OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING
NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS
SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
```

### LibTIFF

https://gitlab.com/libtiff/libtiff

```text
LibTIFF license

Copyright © 1988-1997 Sam Leffler
Copyright © 1991-1997 Silicon Graphics, Inc.

Permission to use, copy, modify, distribute, and sell this software and
its documentation for any purpose is hereby granted without fee, provided
that (i) the above copyright notices and this permission notice appear in
all copies of the software and related documentation, and (ii) the names of
Sam Leffler and Silicon Graphics may not be used in any advertising or
publicity relating to the software without the specific, prior written
permission of Sam Leffler and Silicon Graphics.

THE SOFTWARE IS PROVIDED "AS-IS" AND WITHOUT WARRANTY OF ANY KIND,
EXPRESS, IMPLIED OR OTHERWISE, INCLUDING WITHOUT LIMITATION, ANY
WARRANTY OF MERCHANTABILITY OR FITNESS FOR A PARTICULAR PURPOSE.

IN NO EVENT SHALL SAM LEFFLER OR SILICON GRAPHICS BE LIABLE FOR
ANY SPECIAL, INCIDENTAL, INDIRECT OR CONSEQUENTIAL DAMAGES OF ANY KIND,
OR ANY DAMAGES WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS,
WHETHER OR NOT ADVISED OF THE POSSIBILITY OF DAMAGE, AND ON ANY THEORY OF
LIABILITY, ARISING OUT OF OR IN CONNECTION WITH THE USE OR PERFORMANCE
OF THIS SOFTWARE.

Lempel-Ziv & Welch Compression (tif_lzw.c) license
The code of tif_lzw.c is derived from the compress program whose code is
derived from software contributed to Berkeley by James A. Woods,
derived from original work by Spencer Thomas and Joseph Orost.

The original Berkeley copyright notice appears below in its entirety:

Copyright (c) 1985, 1986 The Regents of the University of California.
All rights reserved.

This code is derived from software contributed to Berkeley by
James A. Woods, derived from original work by Spencer Thomas
and Joseph Orost.

Redistribution and use in source and binary forms are permitted
provided that the above copyright notice and this paragraph are
duplicated in all such forms and that any documentation,
advertising materials, and other materials related to such
distribution and use acknowledge that the software was developed
by the University of California, Berkeley.  The name of the
University may not be used to endorse or promote products derived
from this software without specific prior written permission.
THIS SOFTWARE IS PROVIDED ``AS IS'' AND WITHOUT ANY EXPRESS OR
IMPLIED WARRANTIES, INCLUDING, WITHOUT LIMITATION, THE IMPLIED
WARRANTIES OF MERCHANTIBILITY AND FITNESS FOR A PARTICULAR PURPOSE.
```

### libjpeg

This software is based in part on the work of the Independent JPEG Group.
