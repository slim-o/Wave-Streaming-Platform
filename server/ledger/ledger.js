import crypto from "crypto";

const LEDGER_LOCK_KEY = 72819003; // arbitrary constant for pg_advisory_xact_lock

function normalizeForStableJson(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.map(normalizeForStableJson);

  if (typeof value === "object") {
    const keys = Object.keys(value).sort();
    const out = {};
    for (const k of keys) out[k] = normalizeForStableJson(value[k]);
    return out;
  }

  return value;
}

export function stableStringifyJson(value) {
  return JSON.stringify(normalizeForStableJson(value));
}

function sha256Hex(input) {
  return crypto.createHash("sha256").update(input).digest("hex");
}

function canonicalEventString(event) {
  return [
    `occurred_at=${event.occurredAt.toISOString()}`,
    `event_type=${event.eventType}`,
    `actor_user_id=${event.actorUserId || ""}`,
    `entity_type=${event.entityType}`,
    `entity_id=${event.entityId}`,
    `chain_index=${event.chainIndex.toString()}`,
    `payload=${stableStringifyJson(event.payload || {})}`
  ].join("|");
}

export async function appendLedgerEvent(client, input) {
  const [result] = await appendLedgerEvents(client, [input]);
  return result;
}

export async function appendLedgerEvents(client, inputs) {
  if (!Array.isArray(inputs) || inputs.length === 0) return [];

  await client.query("SELECT pg_advisory_xact_lock($1::bigint)", [LEDGER_LOCK_KEY]);

  const lastRes = await client.query(
    `SELECT chain_index, event_hash
     FROM public.ledger_events
     ORDER BY chain_index DESC
     LIMIT 1`
  );

  let lastIndex = lastRes.rows[0]?.chain_index != null ? BigInt(lastRes.rows[0].chain_index) : 0n;
  let prevHash = lastRes.rows[0]?.event_hash || null;

  const results = [];

  for (const input of inputs) {
    lastIndex += 1n;

    const event = {
      occurredAt: input.occurredAt instanceof Date ? input.occurredAt : new Date(input.occurredAt),
      eventType: input.eventType,
      actorUserId: input.actorUserId || null,
      entityType: input.entityType,
      entityId: input.entityId,
      payload: input.payload || {},
      chainIndex: lastIndex
    };

    const canonical = canonicalEventString(event);
    const hashInput = `${prevHash || ""}|${canonical}`;
    const eventHash = sha256Hex(hashInput);

    const insertRes = await client.query(
      `INSERT INTO public.ledger_events
       (occurred_at, event_type, actor_user_id, entity_type, entity_id, payload, chain_index, prev_hash, event_hash)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::bigint, $8, $9)
       RETURNING id, chain_index, event_hash`,
      [
        event.occurredAt,
        event.eventType,
        event.actorUserId,
        event.entityType,
        event.entityId,
        stableStringifyJson(event.payload),
        event.chainIndex.toString(),
        prevHash,
        eventHash
      ]
    );

    const row = insertRes.rows[0];
    results.push({ id: row.id, chainIndex: row.chain_index, eventHash: row.event_hash });
    prevHash = row.event_hash;
  }

  return results;
}

