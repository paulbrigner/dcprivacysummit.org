import assert from "node:assert/strict";
import test from "node:test";
import { createContactHandler } from "./index.mjs";

const ORIGIN = "https://staging.dcprivacysummit.org";

function conditionalFailure() {
  const error = new Error("condition failed");
  error.name = "ConditionalCheckFailedException";
  return error;
}

function createHarness(options = {}) {
  let currentTime = Date.parse("2026-08-13T12:00:00Z");
  const items = new Map();
  const counters = new Map();
  const sentEmails = [];
  const logs = [];

  const ddbSend = async (command) => {
    const input = command.input;
    if (command.constructor.name === "PutCommand") {
      if (items.has(input.Item.pk)) throw conditionalFailure();
      items.set(input.Item.pk, input.Item);
      return {};
    }
    if (command.constructor.name === "UpdateCommand") {
      const count = counters.get(input.Key.pk) ?? 0;
      if (count >= input.ExpressionAttributeValues[":limit"]) throw conditionalFailure();
      counters.set(input.Key.pk, count + 1);
      return {};
    }
    if (command.constructor.name === "DeleteCommand") {
      items.delete(input.Key.pk);
      return {};
    }
    throw new Error(`Unexpected command: ${command.constructor.name}`);
  };

  const handler = createContactHandler({
    ddbSend,
    sesSend: async (command) => {
      sentEmails.push(command.input);
      return {};
    },
    tableName: "test-table",
    hmacSecret: "test-secret-that-is-long-enough-for-hmac",
    allowedOrigins: new Set([ORIGIN]),
    sourceEmail: "admin@dcprivacysummit.org",
    destinationEmails: ["recipient@example.com"],
    now: () => currentTime,
    randomUUID: () => `nonce-${items.size}-${counters.size}`,
    logger: {
      info: (message) => logs.push(message),
      error: (message) => logs.push(message),
    },
    ...options,
  });

  const event = (method, body, overrides = {}) => ({
    headers: { origin: ORIGIN },
    body: body === undefined ? undefined : JSON.stringify(body),
    requestContext: {
      requestId: "request-1",
      http: { method, sourceIp: "198.51.100.8" },
    },
    ...overrides,
  });

  async function issueToken() {
    const result = await handler(event("GET"));
    assert.equal(result.statusCode, 200);
    return JSON.parse(result.body).token;
  }

  return {
    handler,
    event,
    issueToken,
    sentEmails,
    logs,
    advance: (milliseconds) => { currentTime += milliseconds; },
  };
}

const validPayload = (token, overrides = {}) => ({
  name: "Ada Lovelace",
  email: "ada@example.com",
  message: "I would like to discuss sponsoring the summit.",
  website: "",
  token,
  ...overrides,
});

test("rejects a direct POST without a server-issued token", async () => {
  const harness = createHarness();
  const result = await harness.handler(harness.event("POST", validPayload(undefined)));
  assert.equal(result.statusCode, 403);
  assert.equal(harness.sentEmails.length, 0);
});

test("accepts a legitimate submission after the minimum delay", async () => {
  const harness = createHarness();
  const token = await harness.issueToken();
  harness.advance(3000);
  const result = await harness.handler(harness.event("POST", validPayload(token)));
  assert.equal(result.statusCode, 200);
  assert.equal(harness.sentEmails.length, 1);
  assert.equal(harness.sentEmails[0].Destination.ToAddresses[0], "recipient@example.com");
});

test("rejects immediate use and replay of a valid token", async () => {
  const harness = createHarness();
  const token = await harness.issueToken();
  const tooFast = await harness.handler(harness.event("POST", validPayload(token)));
  assert.equal(tooFast.statusCode, 429);
  harness.advance(3000);
  const first = await harness.handler(harness.event("POST", validPayload(token)));
  assert.equal(first.statusCode, 200);
  const replay = await harness.handler(harness.event("POST", validPayload(token, { message: "A different legitimate message for the summit." })));
  assert.equal(replay.statusCode, 409);
  assert.equal(harness.sentEmails.length, 1);
});

test("binds tokens to the connection source IP", async () => {
  const harness = createHarness();
  const token = await harness.issueToken();
  harness.advance(3000);
  const result = await harness.handler(harness.event("POST", validPayload(token), {
    headers: { origin: ORIGIN },
    requestContext: { requestId: "request-2", http: { method: "POST", sourceIp: "203.0.113.9" } },
  }));
  assert.equal(result.statusCode, 403);
  assert.equal(harness.sentEmails.length, 0);
});

test("suppresses duplicate messages and enforces the hourly source limit", async () => {
  const harness = createHarness({ perIpHourlyLimit: 2 });

  let token = await harness.issueToken();
  harness.advance(3000);
  assert.equal((await harness.handler(harness.event("POST", validPayload(token)))).statusCode, 200);

  token = await harness.issueToken();
  harness.advance(3000);
  const duplicate = await harness.handler(harness.event("POST", validPayload(token)));
  assert.equal(duplicate.statusCode, 200);
  assert.equal(JSON.parse(duplicate.body).message, "Message already received.");

  token = await harness.issueToken();
  harness.advance(3000);
  const limited = await harness.handler(harness.event("POST", validPayload(token, {
    message: "This is another distinct and legitimate summit question.",
  })));
  assert.equal(limited.statusCode, 429);
  assert.equal(harness.sentEmails.length, 1);
});

test("filters obvious solicitation and never logs message contents", async () => {
  const harness = createHarness();
  const token = await harness.issueToken();
  harness.advance(3000);
  const spamMessage = "Our SEO services provide backlinks. Contact us at https://spam.example and https://chat.example.";
  const result = await harness.handler(harness.event("POST", validPayload(token, { message: spamMessage })));
  assert.equal(result.statusCode, 200);
  assert.equal(harness.sentEmails.length, 0);
  assert.equal(harness.logs.join("\n").includes(spamMessage), false);
  assert.equal(harness.logs.join("\n").includes("ada@example.com"), false);
});

test("fails closed when guard storage is unavailable", async () => {
  const harness = createHarness();
  const token = await harness.issueToken();
  harness.advance(3000);
  const failingHandler = createContactHandler({
    ddbSend: async () => { throw new Error("DynamoDB unavailable"); },
    sesSend: async (command) => harness.sentEmails.push(command.input),
    tableName: "test-table",
    hmacSecret: "test-secret-that-is-long-enough-for-hmac",
    allowedOrigins: new Set([ORIGIN]),
    sourceEmail: "admin@dcprivacysummit.org",
    destinationEmails: ["recipient@example.com"],
    now: () => Date.parse("2026-08-13T12:00:03Z"),
    logger: { info: () => {}, error: () => {} },
  });
  const result = await failingHandler(harness.event("POST", validPayload(token)));
  assert.equal(result.statusCode, 500);
  assert.equal(harness.sentEmails.length, 0);
});

test("releases duplicate suppression when SES delivery fails", async () => {
  let attempts = 0;
  const delivered = [];
  const harness = createHarness({
    sesSend: async (command) => {
      attempts += 1;
      if (attempts === 1) throw new Error("SES unavailable");
      delivered.push(command.input);
    },
  });

  let token = await harness.issueToken();
  harness.advance(3000);
  const failed = await harness.handler(harness.event("POST", validPayload(token)));
  assert.equal(failed.statusCode, 500);

  token = await harness.issueToken();
  harness.advance(3000);
  const retried = await harness.handler(harness.event("POST", validPayload(token)));
  assert.equal(retried.statusCode, 200);
  assert.equal(delivered.length, 1);
});
