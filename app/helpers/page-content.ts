import fetch from "node-fetch";
import * as mupdf from "mupdf";
import dotenv from "dotenv";
import axios from "axios";

dotenv.config();

export async function getPdfPagesBase64(pdfBytes: Uint8Array) {
  const doc = mupdf.Document.openDocument(pdfBytes, "");

  const numberOfPages = doc.countPages();
  const pages: string[] = [];
  for (let i = 0; i < numberOfPages; i++) {
    const newDocument = new mupdf.PDFDocument();
    newDocument.graftPage(0, doc as mupdf.PDFDocument, i);
    const buffer = newDocument.saveToBuffer("compress");
    const pageContent = Buffer.from(buffer.asUint8Array()).toString("base64");
    pages.push(pageContent);
    // release memory
    newDocument.destroy();
  }

  return pages;
}

export async function getPageHtmlBase64(base64Content: string) {
  const response = await axios.post(
    process.env.EXTRACT_TEXT_AND_TABLES_ENDPOINT || "",
    {
      format: "html",
      base64String: base64Content,
    }
  );

  return response.data.data[0];
}

export const getTables = async (base64Content: string) => {
  const url = process.env.EXTRACT_TABLES_ENDPOINT || "";
  const apiKey = process.env.EXTRACT_TABLES_KEY || "";

  const myHeaders = new Headers();
  myHeaders.append("x-api-key", apiKey);
  myHeaders.append("Content-Type", "application/json");

  const raw = JSON.stringify({
    file: base64Content,
    pages: "1",
  });

  const requestOptions: RequestInit = {
    method: "POST",
    headers: myHeaders,
    body: raw,
    redirect: "follow",
  };

  const response = await fetch(url, requestOptions as any);
  const responseJson = await response.json();

  return responseJson as any[];
};

export async function extractText(base64Content: string) {
  const pdfBytes = Buffer.from(base64Content, "base64");
  const doc = mupdf.Document.openDocument(pdfBytes, "application/pdf");
  const pdfPage = doc.loadPage(0);
  const pageBounds = pdfPage.getBounds();
  const structuredText = pdfPage.toStructuredText();
  doc.destroy();
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

export async function createPageHtml(base64Content: string) {
  const structuredTextObj = await extractText(base64Content);
  const tablesResult = await getTables(base64Content);
  const pageHtml: any[] = [];
  const tableIncluded = new Set();

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

// to visually debug
export async function createPageSvg(base64Content: string) {
  const structuredTextObj = await extractText(base64Content);
  const tablesResult = await getTables(base64Content);
  const rectangles: any[] = [];
  for (let block of structuredTextObj.blocks) {
    const { x: blockX, y: blockY, w: blockW, h: blockH } = block.bbox;
    rectangles.push(
      `<rect width="${blockW}" height="${blockH}" x="${blockX}" y="${blockY}" stroke="black" fill="none"/>`
    );
  }
  for (let table of tablesResult) {
    if (table.parsing_report.accuracy >= 90) {
      const bbox = table.bbox;
      const tableW = bbox[2] - bbox[0];
      const tableH = bbox[3] - bbox[1];
      const tableX = bbox[0];
      const tableY = structuredTextObj.page.h - bbox[1] - tableH;
      rectangles.push(
        `<rect width="${tableW}" height="${tableH}" x="${tableX}" y="${tableY}" stroke="red" fill="none"/>`
      );
    }
  }

  return `<svg width="${structuredTextObj.page.w}" height="${structuredTextObj.page.h}" xmlns="http://www.w3.org/2000/svg">
    ${rectangles.join("\n")}
  </svg>`;
}
