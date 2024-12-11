import fetch from "node-fetch";
import dotenv from "dotenv";

dotenv.config();

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

  return responseJson;
};
