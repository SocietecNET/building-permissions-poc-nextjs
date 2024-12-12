import { NextApiRequest, NextApiResponse } from "next";
// @ts-ignore
import * as mupdf from "mupdf";
import { getTables } from "@/app/helpers/getTables";

export const config = {
  api: {
    bodyParser: {
      sizeLimit: "100mb", // Set desired value here
    },
  },
  maxDuration: 60,
};
export const runtime = "nodejs";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  try {
    const base64String = req.body.base64String;
    const format = req.body.format;

    if (!base64String) {
      return res.status(400).json({ error: "Base64 string is required" });
    }

    let data;
    switch (format) {
      case "png":
        data = extractPdfAsPng(base64String);
        break;
      case "html":
        data = await extractPdfAsHtml(base64String);
        break;
      default:
        return res.status(400).json({ error: "Incorrect format" });
    }

    return res.status(200).json({ data });
  } catch (error) {
    console.log(error);
    return res.status(400).json({ error });
  }
}

/**
 * Converts a pdf file to HTML string.
 * @param base64String
 * @returns An array of html strings.
 */
function extractPdfAsPng(base64String: string) {
  const data = [];

  const buffer = Buffer.from(base64String, "base64");
  const pdfDoc = mupdf.Document.openDocument(buffer, "application/pdf");
  const totalPages = pdfDoc.countPages();

  for (let i = 0; i < totalPages; i++) {
    console.log("Processing page " + i);
    const page = pdfDoc.loadPage(i);
    const pixmap = page.toPixmap(
      mupdf.Matrix.scale(216 / 72, 216 / 72),
      mupdf.ColorSpace.DeviceRGB,
      false,
      true
    );
    const pixmapBuffer = pixmap.asPNG();
    const pngBase64 = uint8ArrayToBase64(pixmapBuffer);
    data.push(pngBase64);
  }

  return data;
}
async function extractPdfAsHtml(base64String: string) {
  const data = [];
  // load PDF
  const buffer = Buffer.from(base64String, "base64");

  const pdfDoc = mupdf.Document.openDocument(buffer, "application/pdf");
  const totalPages = pdfDoc.countPages();
  for (let i = 0; i < totalPages; i++) {
    console.log("Processing page " + i);
    const page = pdfDoc.loadPage(i);
    data.push(await createPageHtml(page));
  }
  return data;
}

/**
 * Converts a mupdf PDFPage to a html string
 * @param page mupdf PDFPage
 * @returns the html content of the page as a string
 */
async function createPageHtml(page: mupdf.PDFPage | mupdf.Page) {
  const pageHtml: any[] = [];
  const tableIncluded = new Set();
  const structuredTextObj = await extractText(page);

  // @ts-ignore Acces the page as a document directly
  const buffer = (page._doc as mupdf.PDFDocument).saveToBuffer("compress");
  const pdfBase64 = uint8ArrayToBase64(buffer.asUint8Array());
  const tablesResult = (await getTables(pdfBase64)) as any[];

  for (let block of structuredTextObj.blocks) {
    const tablesContainingTheBlock = tablesResult.filter((tableResult) => {
      const bbox = tableResult.bbox;
      const tableW = bbox[2] - bbox[0];
      const tableH = bbox[3] - bbox[1];
      const tableX = bbox[0];
      const tableY = structuredTextObj.page.h - bbox[1] - tableH;
      const tableBbox = {
        x: tableX,
        y: tableY,
        w: tableW,
        h: tableH,
      };
      return areBoundingBoxesIntersecting(block.bbox, tableBbox);
    });

    if (tablesContainingTheBlock.length > 0) {
      // skip text that is inside a table and insert the table instead
      for (let table of tablesContainingTheBlock) {
        const tableIndex = tablesResult.indexOf(table);
        if (!tableIncluded.has(tableIndex)) {
          pageHtml.push(
            table.html.replace("<table ", `<table id="table${tableIndex + 1}" `)
          );
        }
        tableIncluded.add(tableIndex);
      }
      continue;
    }

    // convert block to html
    let lines: any[] = [];
    for (let line of block.lines) {
      if (line?.text?.trim()) {
        lines.push(`<p>${line.text}</p>`);
      }
    }
    if (lines.length > 0) {
      pageHtml.push(`<div>\n${lines.join("\n")}\n</div>`);
    }
  }

  return pageHtml.join("\n");
}

/**
 * splits a PDF file in many one-page PDFs, one for each page
 */
async function extractText(pdfPage: mupdf.PDFPage | mupdf.Page) {
  const pageBounds = pdfPage.getBounds();

  const structuredText = pdfPage.toStructuredText();
  const structuredTextObj = JSON.parse(structuredText.asJSON());
  return {
    ...structuredTextObj,
    page: {
      w: pageBounds[2] - pageBounds[0],
      h: pageBounds[3] - pageBounds[1],
    },
  };
}

interface BoundingBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

function isPointInsideBox(px: number, py: number, box: BoundingBox): boolean {
  return (
    px >= box.x && px <= box.x + box.w && py >= box.y && py <= box.y + box.h
  );
}

function areBoundingBoxesIntersecting(r1: BoundingBox, r2: BoundingBox) {
  return isPointInsideBox(r1.x + r1.w / 2, r1.y + r1.h / 2, r2);
}

function uint8ArrayToBase64(uint8Array: Uint8Array) {
  // Convert Uint8Array to binary string
  let binaryString = "";
  for (let i = 0; i < uint8Array.length; i++) {
    binaryString += String.fromCharCode(uint8Array[i]);
  }

  // Convert binary string to base64
  return btoa(binaryString);
}
