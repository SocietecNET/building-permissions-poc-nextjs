import { NextApiRequest, NextApiResponse, NextConfig } from "next";
import * as cheerio from "cheerio";
import {
  getPageHtmlBase64,
  getPdfPagesBase64,
} from "@/app/helpers/page-content";
import {
  euclideanDistance,
  getEmbeddings,
  getTableDescriptions,
  referenceTableIndex,
} from "@/app/helpers/semantic-search";
import pLimit from "p-limit";

// config
export const config = {
  api: {
    bodyParser: {
      sizeLimit: "100mb",
    },
  },
  maxDuration: 60,
};
export const runtime = "nodejs";

async function processPdfPage(pageNumber: number, base64PageContent: string) {
  const pdfIndex: any[] = [];
  const htmlContent = await getPageHtmlBase64(base64PageContent);

  // create embeddings/index for tables
  const $ = cheerio.load(htmlContent);
  if ($("table").length < 1) {
    return pdfIndex;
  }

  const tableDescriptions = await getTableDescriptions(htmlContent);
  for (let row of tableDescriptions) {
    // for cases when LLM hallucinates
    if (!row.tableId) {
      continue;
    }
    const tableElement = $(`#${row.tableId}`);
    const tableHtml = $.html(tableElement.removeAttr("id"));

    const contentForIndex = `${row.tableTitle}
${row.tableDescription}
${tableHtml}`;
    const embeddings = await getEmbeddings(contentForIndex);
    pdfIndex.push({
      pageNumber,
      contentForIndex,
      embeddings,
    });
  }

  return pdfIndex;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  // input
  const base64String = req.body.base64String;

  // read from pdf
  const pdfBytes = Buffer.from(base64String, "base64");
  const pdfPagesBase64 = await getPdfPagesBase64(pdfBytes);

  const limit = pLimit(4); // Limit to 4 concurrent executions
  const promises = pdfPagesBase64.map(async (page, pageIndex) => {
    const result = await limit(async () => {
      try {
        return await processPdfPage(pageIndex + 1, page);
      } catch {
        return [];
      }
    });
    return result;
  });

  const results = await Promise.all(promises);

  let pdfIndex: any[] = [];
  for (let result of results) {
    pdfIndex = [...pdfIndex, ...result];
  }

  // search
  const searchResultList = pdfIndex
    .map((item) => {
      const $ = cheerio.load(item.contentForIndex);
      const tableElement = $("table");
      return {
        pageNumber: item.pageNumber,
        distance: euclideanDistance(item.embeddings, referenceTableIndex),
        table: $.html(tableElement),
      };
    })
    .sort((item1, item2) => item1.distance - item2.distance);

  // return the result
  res.json(searchResultList);
}
