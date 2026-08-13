import crypto from "node:crypto";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DeleteCommand, DynamoDBDocumentClient, PutCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { SESClient, SendEmailCommand } from "@aws-sdk/client-ses";

const EMAIL_REGEX = /^[^\s@]{1,64}@[^\s@]{1,189}\.[^\s@]{2,63}$/;
const URL_REGEX = /(?:https?:\/\/|www\.)\S+/gi;
const SPAM_PHRASES = [
  "backlink",
  "guest post",
  "increase your traffic",
  "first page of google",
  "seo services",
  "website ranking",
  "web design services",
];
const DISPOSABLE_DOMAINS = new Set([
  "10minutemail.com",
  "guerrillamail.com",
  "mailinator.com",
  "tempmail.com",
  "yopmail.com",
]);
const ALLOWED_FIELDS = new Set(["name", "email", "message", "website", "token"]);

const response = (statusCode, body) => ({
  statusCode,
  headers: {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
  },
  body: JSON.stringify(body),
});

const safeEqual = (left, right) => {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
};

const digest = (secret, value) =>
  crypto.createHmac("sha256", secret).update(value).digest("hex");

const normalizeMessage = (value) => value.trim().replace(/\s+/g, " ").toLowerCase();

const escapeHtml = (value = "") =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const isConditionalFailure = (error) => error?.name === "ConditionalCheckFailedException";

export function createContactHandler({
  ddbSend,
  sesSend,
  tableName,
  hmacSecret,
  allowedOrigins,
  sourceEmail,
  destinationEmails,
  now = () => Date.now(),
  randomUUID = () => crypto.randomUUID(),
  logger = console,
  minTokenAgeMs = 3000,
  maxTokenAgeMs = 30 * 60 * 1000,
  perIpHourlyLimit = 3,
  globalDailyLimit = 25,
  maxBodyBytes = 8192,
}) {
  if (!tableName || !hmacSecret || !sourceEmail || destinationEmails.length === 0) {
    throw new Error("Contact handler configuration is incomplete.");
  }

  const logOutcome = (event, outcome, ipHash, extra = {}) => {
    logger.info(JSON.stringify({
      requestId: event?.requestContext?.requestId,
      outcome,
      rejected: outcome.includes("rejected") || outcome.startsWith("token_"),
      source: ipHash.slice(0, 12),
      ...extra,
    }));
  };

  const incrementCounter = async (pk, limit, expiresAt) => {
    try {
      await ddbSend(new UpdateCommand({
        TableName: tableName,
        Key: { pk },
        UpdateExpression: "SET #count = if_not_exists(#count, :zero) + :one, expiresAt = :expiresAt",
        ConditionExpression: "attribute_not_exists(#count) OR #count < :limit",
        ExpressionAttributeNames: { "#count": "count" },
        ExpressionAttributeValues: {
          ":zero": 0,
          ":one": 1,
          ":limit": limit,
          ":expiresAt": expiresAt,
        },
      }));
      return true;
    } catch (error) {
      if (isConditionalFailure(error)) return false;
      throw error;
    }
  };

  const putOnce = async (pk, expiresAt) => {
    try {
      await ddbSend(new PutCommand({
        TableName: tableName,
        Item: { pk, expiresAt },
        ConditionExpression: "attribute_not_exists(pk)",
      }));
      return true;
    } catch (error) {
      if (isConditionalFailure(error)) return false;
      throw error;
    }
  };

  const issueToken = (sourceIp, timestamp) => {
    const payload = Buffer.from(JSON.stringify({ n: randomUUID(), i: timestamp })).toString("base64url");
    const signature = digest(hmacSecret, `${payload}.${sourceIp}`);
    return `${payload}.${signature}`;
  };

  const validateAndConsumeToken = async (token, sourceIp, timestamp) => {
    if (typeof token !== "string" || token.length > 1024) return "invalid";
    const [payload, suppliedSignature, extra] = token.split(".");
    if (!payload || !suppliedSignature || extra) return "invalid";

    const expectedSignature = digest(hmacSecret, `${payload}.${sourceIp}`);
    if (!safeEqual(suppliedSignature, expectedSignature)) return "invalid";

    let decoded;
    try {
      decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    } catch {
      return "invalid";
    }

    if (typeof decoded.n !== "string" || typeof decoded.i !== "number") return "invalid";
    const age = timestamp - decoded.i;
    if (age < minTokenAgeMs) return "too_fast";
    if (age > maxTokenAgeMs || age < 0) return "expired";

    const consumed = await putOnce(
      `token#${digest(hmacSecret, decoded.n)}`,
      Math.floor((timestamp + maxTokenAgeMs) / 1000),
    );
    return consumed ? "valid" : "replayed";
  };

  return async function handler(event) {
    const timestamp = now();
    const method = event?.requestContext?.http?.method;
    const sourceIp = event?.requestContext?.http?.sourceIp ?? "unknown";
    const ipHash = digest(hmacSecret, sourceIp);
    const origin = event?.headers?.origin ?? event?.headers?.Origin;

    if (!allowedOrigins.has(origin)) {
      logOutcome(event, "origin_rejected", ipHash);
      return response(403, { message: "Request rejected." });
    }

    if (method === "GET") {
      return response(200, {
        token: issueToken(sourceIp, timestamp),
        expiresInSeconds: Math.floor(maxTokenAgeMs / 1000),
      });
    }

    if (method !== "POST") {
      return response(405, { message: "Method not allowed." });
    }

    try {
      if (!event.body) return response(400, { message: "Request body is required." });
      const rawBody = event.isBase64Encoded
        ? Buffer.from(event.body, "base64")
        : Buffer.from(event.body, "utf8");
      if (rawBody.byteLength > maxBodyBytes) {
        logOutcome(event, "body_too_large", ipHash, { bytes: rawBody.byteLength });
        return response(413, { message: "Message is too large." });
      }

      let payload;
      try {
        payload = JSON.parse(rawBody.toString("utf8"));
      } catch {
        return response(400, { message: "Invalid JSON payload." });
      }
      if (!payload || Array.isArray(payload) || typeof payload !== "object") {
        return response(400, { message: "Invalid request." });
      }
      if (Object.keys(payload).some((field) => !ALLOWED_FIELDS.has(field))) {
        return response(400, { message: "Unexpected request fields." });
      }

      if (typeof payload.website === "string" && payload.website.trim() !== "") {
        logOutcome(event, "honeypot_rejected", ipHash);
        return response(200, { message: "Message received." });
      }

      const tokenStatus = await validateAndConsumeToken(payload.token, sourceIp, timestamp);
      if (tokenStatus === "too_fast") {
        return response(429, { message: "Please take a moment before submitting." });
      }
      if (tokenStatus !== "valid") {
        logOutcome(event, `token_${tokenStatus}`, ipHash);
        return response(tokenStatus === "replayed" ? 409 : 403, {
          message: tokenStatus === "expired" ? "Form session expired. Please try again." : "Request rejected.",
        });
      }

      const { name, email, message } = payload;
      if ([name, email, message].some((field) => typeof field !== "string")) {
        return response(400, { message: "Name, email, and message are required." });
      }
      const cleanName = name.trim();
      const cleanEmail = email.trim().toLowerCase();
      const cleanMessage = message.trim();
      if (cleanName.length < 2 || cleanName.length > 120) {
        return response(400, { message: "Please provide a valid full name." });
      }
      if (cleanEmail.length > 254 || !EMAIL_REGEX.test(cleanEmail)) {
        return response(400, { message: "Please provide a valid email address." });
      }
      if (cleanMessage.length < 10 || cleanMessage.length > 3000) {
        return response(400, { message: "Message must be between 10 and 3000 characters." });
      }

      const hourBucket = new Date(timestamp).toISOString().slice(0, 13);
      const ipAllowed = await incrementCounter(
        `rate#${ipHash}#${hourBucket}`,
        perIpHourlyLimit,
        Math.floor((timestamp + 2 * 60 * 60 * 1000) / 1000),
      );
      if (!ipAllowed) {
        logOutcome(event, "ip_limit_rejected", ipHash);
        return response(429, { message: "Submission limit reached. Please try again later." });
      }

      const messageHash = digest(hmacSecret, `${cleanEmail}\n${normalizeMessage(cleanMessage)}`);
      const unique = await putOnce(
        `duplicate#${messageHash}`,
        Math.floor((timestamp + 7 * 24 * 60 * 60 * 1000) / 1000),
      );
      if (!unique) {
        logOutcome(event, "duplicate_rejected", ipHash);
        return response(200, { message: "Message already received." });
      }

      const lowerMessage = cleanMessage.toLowerCase();
      const urlCount = (cleanMessage.match(URL_REGEX) ?? []).length;
      const domain = cleanEmail.split("@")[1];
      let spamScore = 0;
      if (urlCount > 1) spamScore += 1;
      if (SPAM_PHRASES.some((phrase) => lowerMessage.includes(phrase))) spamScore += 1;
      if (DISPOSABLE_DOMAINS.has(domain)) spamScore += 1;
      if (/(telegram|whatsapp)/i.test(cleanMessage) && urlCount > 0) spamScore += 1;
      if (spamScore >= 2) {
        logOutcome(event, "content_rejected", ipHash, { spamScore, urlCount });
        return response(200, { message: "Message received." });
      }

      const dayBucket = new Date(timestamp).toISOString().slice(0, 10);
      const dailyAllowed = await incrementCounter(
        `daily#${dayBucket}`,
        globalDailyLimit,
        Math.floor((timestamp + 2 * 24 * 60 * 60 * 1000) / 1000),
      );
      if (!dailyAllowed) {
        logOutcome(event, "daily_limit_rejected", ipHash);
        return response(429, { message: "The contact form is temporarily unavailable." });
      }

      const textBody = `You have received a new message.\n\nName: ${cleanName}\nEmail: ${cleanEmail}\nMessage:\n${cleanMessage}`;
      const htmlBody = `<html><body><h3>New DC Privacy Summit contact message</h3><p><strong>Name:</strong> ${escapeHtml(cleanName)}</p><p><strong>Email:</strong> ${escapeHtml(cleanEmail)}</p><p><strong>Message:</strong></p><p>${escapeHtml(cleanMessage).replace(/\n/g, "<br>")}</p></body></html>`;
      try {
        await sesSend(new SendEmailCommand({
          Source: sourceEmail,
          Destination: { ToAddresses: destinationEmails },
          Message: {
            Subject: { Data: `DC Privacy Summit contact: ${cleanName}`, Charset: "UTF-8" },
            Body: {
              Text: { Data: textBody, Charset: "UTF-8" },
              Html: { Data: htmlBody, Charset: "UTF-8" },
            },
          },
          ReplyToAddresses: [cleanEmail],
        }));
      } catch (error) {
        await ddbSend(new DeleteCommand({
          TableName: tableName,
          Key: { pk: `duplicate#${messageHash}` },
        })).catch(() => {});
        throw error;
      }
      logOutcome(event, "email_sent", ipHash);
      return response(200, { message: "Message sent successfully!" });
    } catch (error) {
      logger.error(JSON.stringify({
        requestId: event?.requestContext?.requestId,
        outcome: "internal_error",
        rejected: true,
        errorName: error?.name,
      }));
      return response(500, { message: "Failed to process request." });
    }
  };
}

let runtimeHandler;

export const handler = async (event) => {
  if (!runtimeHandler) {
    const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
    const ses = new SESClient({ region: process.env.SES_REGION ?? "us-east-1" });
    runtimeHandler = createContactHandler({
      ddbSend: (command) => ddb.send(command),
      sesSend: (command) => ses.send(command),
      tableName: process.env.GUARD_TABLE,
      hmacSecret: process.env.HMAC_SECRET,
      allowedOrigins: new Set((process.env.ALLOWED_ORIGINS ?? "").split(",").map((value) => value.trim()).filter(Boolean)),
      sourceEmail: process.env.SOURCE_EMAIL ?? "admin@dcprivacysummit.org",
      destinationEmails: (process.env.DESTINATION_EMAILS ?? "").split(",").map((value) => value.trim()).filter(Boolean),
      minTokenAgeMs: Number(process.env.MIN_TOKEN_AGE_MS ?? "3000"),
      maxTokenAgeMs: Number(process.env.MAX_TOKEN_AGE_MS ?? "1800000"),
      perIpHourlyLimit: Number(process.env.PER_IP_HOURLY_LIMIT ?? "3"),
      globalDailyLimit: Number(process.env.GLOBAL_DAILY_LIMIT ?? "25"),
      maxBodyBytes: Number(process.env.MAX_BODY_BYTES ?? "8192"),
    });
  }
  return runtimeHandler(event);
};
